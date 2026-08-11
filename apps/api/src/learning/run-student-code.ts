import * as vm from 'node:vm';

/**
 * Executes student-submitted JavaScript for `RUN` exercises so the server
 * can check console output itself instead of trusting a client-reported
 * "it worked" flag.
 *
 * SECURITY CAVEAT: Node's built-in `vm` module is NOT a real security
 * sandbox — it does not protect against a sufficiently malicious payload
 * (there are well-known escape techniques). This is acceptable for now
 * because the only actor submitting code is an authenticated student
 * answering an educational exercise, mirroring exactly the trust model the
 * current frontend already uses (it runs the same code in a sandboxed
 * iframe on the STUDENT'S OWN machine — here it runs on the server, which
 * is a materially different risk). Before this handles untrusted traffic
 * at scale, replace this with a real isolate (isolated-vm) or an external
 * execution service.
 */
export interface RunResult {
  out: string[];
  error?: string;
  timeout?: boolean;
}

export function runStudentCode(code: string, timeoutMs = 2500): RunResult {
  const out: string[] = [];
  const fmt = (a: unknown) => {
    try {
      return typeof a === 'object' ? JSON.stringify(a) : String(a);
    } catch {
      return String(a);
    }
  };
  const sandbox: Record<string, unknown> = {
    console: {
      log: (...args: unknown[]) => {
        out.push(args.map(fmt).join(' '));
        if (out.length > 200) throw new Error('Demasiada salida');
      },
    },
  };
  try {
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { timeout: timeoutMs });
    return { out };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/timed out|Script execution timed out/i.test(message)) {
      return { out, timeout: true };
    }
    return { out, error: message };
  }
}
