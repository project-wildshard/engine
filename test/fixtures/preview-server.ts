// oxlint-disable-next-line import/no-nodejs-modules -- Runs the plain preview server for a test's own fixture build.
import { spawn } from 'node:child_process';

/** scripts/preview-server.mjs over `<root>/dist` on a free port: its base URL and a close. */
export async function previewServer(root: string, telemetryDirectory?: string): Promise<{ readonly base: string; readonly close: () => void }> {
  const child = spawn(process.execPath, ['scripts/preview-server.mjs', '--root', root, '--outDir', 'dist', '--port', '0',
    ...(telemetryDirectory === undefined ? [] : ['--telemetry-dir', telemetryDirectory])], { stdio: ['ignore', 'pipe', 'inherit'] });
  const base = await new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (data: Buffer) => { const match = /http:\/\/127\.0\.0\.1:\d+\//u.exec(String(data)); if (match !== null) resolve(match[0]); });
    child.once('exit', code => { reject(new Error(`preview server exited ${String(code)}`)); });
  });
  return { base, close: () => { child.kill('SIGTERM'); } };
}
