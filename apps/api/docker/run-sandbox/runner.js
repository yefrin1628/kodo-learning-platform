// Runs inside the ephemeral sandbox container only — reads the student's
// code from stdin, executes it, and writes a JSON result to stdout. The
// same vm-based execution as the old in-process run-student-code.ts, but
// now it's a defense-in-depth layer on top of the REAL security boundary
// (the container itself: --network=none, --read-only, --cap-drop=ALL,
// non-root user, resource limits — set by execution.service.ts's `docker
// run` invocation, not by anything in here).
'use strict';
const vm = require('node:vm');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function run(code, timeoutMs) {
  const out = [];
  const fmt = (a) => {
    try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
    catch { return String(a); }
  };
  const sandbox = {
    console: {
      log: (...args) => {
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
    if (/timed out|Script execution timed out/i.test(message)) return { out, timeout: true };
    return { out, error: message };
  }
}

readStdin().then((code) => {
  const result = run(code, 2500);
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}).catch((e) => {
  process.stdout.write(JSON.stringify({ out: [], error: String(e) }));
  process.exit(0);
});
