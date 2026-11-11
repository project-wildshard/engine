#!/usr/bin/env node
// TB-1 (J233): the warm Rolldown watcher behind `pnpm test:e2e`. One per worktree. It runs under a heavy-lane build
// lease (scripts/e2e-client.mjs starts it), bundles the real client once through the same pipeline as build-app.mjs,
// then rebuilds on each source change and serves the finished build with scripts/preview-server.mjs. A smoke run asks
// it for a settled build over HTTP on 127.0.0.1. It exits after E2E_WATCH_IDLE_MIN idle minutes (default 10), which
// frees the lease, and when the inputs it prepared once (the catalogue, the installed Template 2) change under it.
//
// Measured on the Mac (TEMPLATE-E2E-PLAN, TB-1): after a one-line client edit, `pnpm test:e2e` had its client in
// 11.4 to 12.1 s in a worktree holding every pin (the finish copies and parts every product in out/), and 4.3 to 4.4 s
// with Template 2 alone. The bundle itself is about 1 s. A fresh build without tsc took 7.9 to 12.7 s with Template 2
// alone, and the unbundled dev server failed to boot cleanly.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { E2E_DIR, CLIENT_DIR, STATE_FILE, BUILD_ID, preparedKey } from './e2e-paths.mjs';

const root = process.cwd();
const outDir = resolvePath(root, CLIENT_DIR), state = resolvePath(root, STATE_FILE);
const idleMs = Number(process.env.E2E_WATCH_IDLE_MIN ?? '10') * 60_000;
// A change event needs one poll to be seen (100 ms below): a ready request waits this long before it trusts "quiet".
const SETTLE_MS = 300;
mkdirSync(resolvePath(root, E2E_DIR), { recursive: true });

process.env.WS_BUILD_ID = BUILD_ID;
process.env.WS_APP_DEFER_PUBLIC_COPY = '1';
const { prepareAppBuild, finishAppBuild } = await import('./app-build-pipeline.mjs');
const { build } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);

const key = preparedKey(root), token = randomBytes(16).toString('hex'), started = performance.now();
// `started` counts bundles begun and `finished` the last one finished (or failed). A finish that a newer bundle
// overtook read an output folder that bundle was rewriting, so its verdict is dropped and the newer finish decides.
const status = { started: 0, finished: 0, bundling: true, dirty: false, generation: 0, error: /** @type {string|null} */ (null), bundleMs: 0, finishMs: 0 };
/** @type {Array<() => void>} */
let waiters = [];
let lastAsked = performance.now(), bundleStarted = performance.now(), finishing = Promise.resolve();
const wake = () => { const list = waiters; waiters = []; for (const resolve of list) resolve(); };
const settled = () => !status.bundling && !status.dirty && status.finished === status.started;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** Resolve once the source is quiet and the last change is built and finished. */
async function ready() {
  await sleep(SETTLE_MS);
  while (!settled()) await Promise.race([new Promise(resolve => { waiters.push(() => { resolve(undefined); }); }), sleep(250)]);
  await finishing;
}

prepareAppBuild();
const watcher = await build({
  root, configFile: join(root, 'vite.config.ts'),
  build: { outDir, emptyOutDir: true, watch: { chokidar: { usePolling: true, interval: 100 } } },
});
/** finishAppBuild over bundle number `bundle`; finishes run one at a time, in bundle order. @param {number} bundle */
async function finish(bundle) {
  const begun = performance.now();
  /** @type {string|null} */
  let error = null;
  try {
    await finishAppBuild({ outDir, buildId: BUILD_ID, mode: 'production', deferPublic: true });
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  // Overtaken: the newer bundle's own finish follows.
  if (bundle !== status.started) return;
  status.error = error; status.finished = bundle; status.finishMs = performance.now() - begun;
  if (error === null) status.generation += 1;
  wake();
}
/** @param {{code:string,error?:unknown,result?:{close?:() => Promise<void>}}} event */
const onEvent = event => {
  if (event.code === 'BUNDLE_START') {
    status.started += 1; status.bundling = true; status.dirty = false; bundleStarted = performance.now();
    console.log(`e2e-watcher: bundle ${String(status.started)} started`);
  }
  if (event.code === 'ERROR') {
    status.error = event.error instanceof Error ? event.error.message : String(event.error);
    status.bundling = false; status.finished = status.started; wake();
  }
  if (event.code === 'BUNDLE_END') {
    const bundle = status.started;
    status.bundling = false; status.bundleMs = performance.now() - bundleStarted;
    void event.result?.close?.();
    finishing = finishing.then(() => finish(bundle));
  }
};
watcher.on('event', onEvent);
watcher.on('change', () => { status.dirty = true; });

await ready();
console.log(`e2e-watcher: first build ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);
const preview = spawn(process.execPath, ['scripts/preview-server.mjs', '--root', root, '--outDir', outDir, '--host', '127.0.0.1', '--port', '0'],
  { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
/** @type {string} */
const origin = await new Promise((resolve, reject) => {
  let text = '';
  preview.stdout.on('data', chunk => {
    text += String(chunk);
    const url = /Local:\s+(http:\/\/127\.0\.0\.1:\d+)/u.exec(text)?.[1];
    if (url !== undefined) resolve(url);
  });
  preview.once('exit', code => { reject(new Error(`e2e-watcher: preview server exited ${String(code)}`)); });
});

async function stop(code = 0) {
  rmSync(state, { force: true });
  await watcher.close().catch(() => undefined);
  if (preview.exitCode === null) { const closed = once(preview, 'exit'); preview.kill('SIGTERM'); await closed; }
  process.exit(code);
}

/** The settled build's origin and timings, once the source is quiet and built. @param {import('node:http').ServerResponse} response */
async function answer(response) {
  const asked = performance.now();
  await ready();
  const body = { origin, outDir, buildId: BUILD_ID, generation: status.generation, error: status.error,
    waitedMs: performance.now() - asked, bundleMs: status.bundleMs, finishMs: status.finishMs, pid: process.pid };
  response.writeHead(status.error === null ? 200 : 500, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const control = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
  lastAsked = performance.now();
  if (url.pathname === '/ready') {
    if (preparedKey(root) !== key) {
      response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ restart: 'prepared inputs changed' }));
      void stop(0);
      return;
    }
    void answer(response);
    return;
  }
  if (url.pathname === '/stop') { response.writeHead(200).end('{}'); void stop(0); return; }
  response.writeHead(404).end();
});
control.listen(0, '127.0.0.1');
await once(control, 'listening');
const address = control.address();
if (address === null || typeof address === 'string') throw new Error('e2e-watcher: no control port');
writeFileSync(state, `${JSON.stringify({ pid: process.pid, port: address.port, token, key, origin, outDir, startedMs: Date.now() })}\n`);
console.log(`e2e-watcher: control 127.0.0.1:${String(address.port)}, preview ${origin}`);

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { void stop(0); });
setInterval(() => { if (performance.now() - lastAsked > idleMs) void stop(0); }, 15_000).unref();
