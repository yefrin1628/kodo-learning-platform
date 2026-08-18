import { ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';

const IMAGE_NAME = 'kodo-run-sandbox';
// Safety net above the in-container vm timeout (2.5s) — if the container
// somehow doesn't exit on its own (image bug, docker hiccup), this kills
// the whole `docker run` process from the outside.
const WALL_CLOCK_TIMEOUT_MS = 8000;
const MAX_EXECUTIONS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

export interface ExecutionResult {
  out: string[];
  error?: string;
  timeout?: boolean;
}

/**
 * Runs student-submitted code in an ephemeral, isolated Docker container —
 * no network, read-only filesystem, non-root user, all capabilities
 * dropped, hard CPU/memory/process-count limits. This is the real security
 * boundary (see docker/run-sandbox/); the container is destroyed (`--rm`)
 * immediately after each execution, so nothing persists between requests.
 *
 * Concurrency (max 1 in-flight execution per user) and a per-user rate
 * limit are tracked in-memory — correct as long as Kodo runs as a single
 * instance (true today); revisit with shared state (e.g. Redis) before
 * horizontally scaling the API.
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  private readonly activeUsers = new Set<string>();
  private readonly recentRuns = new Map<string, number[]>();

  async run(userId: string, code: string): Promise<ExecutionResult> {
    this.assertNotConcurrent(userId);
    this.assertRateLimit(userId);

    this.activeUsers.add(userId);
    try {
      return await this.execInContainer(code);
    } finally {
      this.activeUsers.delete(userId);
    }
  }

  /** Concurrency limit is 1 per user, enforced by Set membership itself —
   * there's nothing to parameterize (a Set can't tell you "2 active"
   * without becoming a counter, which isn't needed for a limit of 1). */
  private assertNotConcurrent(userId: string): void {
    if (this.activeUsers.has(userId)) {
      throw new ConflictException('Ya tienes una ejecución de código en curso. Espera a que termine.');
    }
  }

  private assertRateLimit(userId: string): void {
    const now = Date.now();
    const history = (this.recentRuns.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (history.length >= MAX_EXECUTIONS_PER_MINUTE) {
      throw new HttpException('Demasiadas ejecuciones de código. Espera un momento e inténtalo de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
    }
    history.push(now);
    this.recentRuns.set(userId, history);
  }

  private execInContainer(code: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const args = [
        'run',
        '--rm',
        '-i',
        '--network=none',
        '--memory=64m',
        '--memory-swap=64m',
        '--cpus=0.5',
        '--pids-limit=32',
        '--read-only',
        '--tmpfs',
        '/tmp:size=8m,noexec',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        IMAGE_NAME,
      ];
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let settled = false;

      const killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, WALL_CLOCK_TIMEOUT_MS);

      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });

      child.on('close', () => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          this.logger.error(`Sandbox produced no valid JSON. stderr: ${stderr.slice(0, 500)}`);
          resolve({ out: [], error: 'No se pudo ejecutar el código. Intenta de nuevo.' });
        }
      });
      child.on('error', (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        this.logger.error(`Failed to spawn docker: ${e.message}`);
        resolve({ out: [], error: 'No se pudo ejecutar el código. Intenta de nuevo.' });
      });

      child.stdin.write(code);
      child.stdin.end();
    });
  }
}
