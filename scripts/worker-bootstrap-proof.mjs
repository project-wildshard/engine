// DL21: explicit outer-edge proof, outside hooks and Vitest discovery.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve as resolvePath, join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { writeStandaloneOutput } from './app-build/standaloneOutput.mjs';

const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
assert.ok(output, 'Pass a disposable --output=<owned scratch parent>');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(resolvePath(output), 'bootstrap-'));
try {
  await writeStandaloneOutput(directory, 'bootstrap-proof', process.cwd());
  const paths = await readdir(join(directory, 'b/bootstrap-proof/standalone'));
  const workerFile = paths.find(path => /^serverWorker.*\.js$/u.test(path));
  assert.ok(workerFile, 'Build emitted no actual worker');
  const runtimeFile = paths.find(path => /^serverRuntime.*\.js$/u.test(path));
  const heldFile = runtimeFile ?? workerFile;
  let release = () => { /* Assigned when each browser owns its barrier. */ }, blocked = false, refuse = false;
  let barrier = Promise.resolve();
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  const handleRequest = async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Worker bootstrap proof</title>'); return; }
    if (path === '/refuse-runtime') { refuse = true; release(); response.end('released'); return; }
    if (path.endsWith(`/${heldFile}`)) { blocked = true; await barrier; if (refuse) { response.writeHead(503); response.end(); return; } }
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(directory, path))); }
    catch { response.writeHead(404); response.end(); }
  };
  const server = createServer((request, response) => { void handleRequest(request, response); });
  await new Promise(resolve => { server.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    for (const name of ['chromium', 'webkit']) {
      blocked = false; refuse = false;
      barrier = new Promise(resolve => { release = resolve; });
      const browser = await (name === 'chromium' ? chromium : webkit).launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${address.port}/`);
        /** @type {{heard: boolean, failed: unknown}} */
        const first = await page.evaluate(async workerPath => {
          const worker = new Worker(workerPath, { type: 'module' });
          const control = new MessageChannel(), game = new MessageChannel();
          let heard = false;
          worker.onmessage = () => { heard = true; };
          const failure = new Promise(resolve => { control.port1.onmessage = event => { resolve(event.data.kind === 'failed'); }; });
          worker.postMessage({ catalogue: null, validator: null, verdicts: null }, [control.port2, game.port2]);
          try {
            await new Promise(resolve => { setTimeout(resolve, 500); });
            if (!heard) return { heard, failed: false };
            await fetch('/refuse-runtime');
            const failed = await Promise.race([failure,
              new Promise(resolve => { setTimeout(() => { resolve(false); }, 1500); })]);
            return { heard, failed };
          }
          finally { control.port1.close(); game.port1.close(); worker.terminate(); }
        }, `/b/bootstrap-proof/standalone/${workerFile}`);
        assert.ok(blocked, `${name}: actual heavy module request was not held`);
        assert.equal(first.heard, true, `${name}: worker has no first message before its heavy graph loads`);
        assert.equal(first.failed, true, `${name}: refused runtime left boot hanging`);
        console.log(`${name}: first message precedes held runtime; import refusal rejects actual boot`);
      } finally { await browser.close(); }
    }
  } finally { release(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); }
} finally { await rm(directory, { recursive: true }); }
