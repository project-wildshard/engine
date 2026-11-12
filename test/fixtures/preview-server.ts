// oxlint-disable-next-line import/no-nodejs-modules -- Runs the plain preview server for a test's own fixture build.
import { spawn } from 'node:child_process';

/**
 * scripts/preview-server.mjs over `<root>/dist` on a free port: its base URL and a close that resolves once the server
 * has exited, so a caller can remove `root` without the server still writing into it (main ci 43141220801, ENOTEMPTY).
 */
export async function previewServer(root: string, telemetryDirectory?: string): Promise<{ readonly base: string; readonly close: () => Promise<void> }> {
  const child = spawn(process.execPath, ['scripts/preview-server.mjs', '--root', root, '--outDir', 'dist', '--port', '0',
    ...(telemetryDirectory === undefined ? [] : ['--telemetry-dir', telemetryDirectory])], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>(resolve => { child.once('exit', () => { resolve(); }); });
  const base = await new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (data: Buffer) => { const match = /http:\/\/127\.0\.0\.1:\d+\//u.exec(String(data)); if (match !== null) resolve(match[0]); });
    child.once('exit', code => { reject(new Error(`preview server exited ${String(code)}`)); });
  });
  return { base, close: async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited; } };
}
