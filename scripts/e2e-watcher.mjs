#!/usr/bin/env node
// TB-1 (J233): the warm Rolldown watcher behind `pnpm test:e2e`. One per worktree. It runs under a heavy-lane build
// lease (scripts/e2e-client.mjs starts it), bundles the real client once through the same pipeline as build-app.mjs,
// then rebuilds on each source change and serves the finished build with scripts/preview-server.mjs. A smoke run asks
// it for a settled build over HTTP on 127.0.0.1. It exits after E2E_WATCH_IDLE_MIN idle minutes (default 10), which
// frees the lease, and when what it loaded once changes: the catalogue or the installed Template 2 (the client's
// prepared key), or any build script under scripts/ (its own pipeline modules).
//
// Rolldown writes each bundle to BUNDLE_DIR. A finish copies that bundle into its own generation folder and finishes
// it there, so a newer bundle never rewrites a folder a finish is reading; CLIENT_DIR is a link to the last generation
// that finished, which the preview server serves. The finish also builds graphs the bundle doesn't watch (the
// standalone shell, the doctor page), so a source change that no bundle picks up gets a fresh finish of the same bundle.
//
// Measured on the Mac (TEMPLATE-E2E-PLAN, TB-1): after a one-line client edit, `pnpm test:e2e` had its client in
// 11.4 to 12.1 s in a worktree holding every pin (the finish copies and parts every product in out/), and 4.3 to 4.4 s
// with Template 2 alone. The bundle itself is about 1 s. A fresh build without tsc took 7.9 to 12.7 s with Template 2
// alone, and the unbundled dev server failed to boot cleanly.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cpSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { E2E_DIR, CLIENT_DIR, STATE_FILE, BUILD_ID, preparedKey } from './e2e-paths.mjs';

const root = process.cwd();
const e2e = resolvePath(root, E2E_DIR), bundleDir = join(e2e, 'bundle'), client = resolvePath(root, CLIENT_DIR);
const state = resolvePath(root, STATE_FILE);
const idleMs = Number(process.env.E2E_WATCH_IDLE_MIN ?? '10') * 60_000;
// A change event needs one poll to be seen (100 ms below): a ready request waits this long before it trusts "quiet".
const SETTLE_MS = 300;
mkdirSync(e2e, { recursive: true });

process.env.WS_BUILD_ID = BUILD_ID;
process.env.WS_APP_DEFER_PUBLIC_COPY = '1';
// A local smoke build: never a release that carries the previous production deploy's chunks over the network.
for (const name of ['VERCEL_ENV', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'WS_PREVIOUS_DEPLOY_DIR', 'WS_PREVIOUS_DEPLOY_ORIGIN']) delete process.env[name];
const { prepareAppBuild, finishAppBuild } = await import('./app-build-pipeline.mjs');
const { build } = await import(pathToFileURL(join(root, 'node_modules/vite/dist/node/index.js')).href);

const key = preparedKey(root), token = randomBytes(16).toString('hex'), started = performance.now();
// `started` counts bundles begun and `finished` the last one finished (or failed). A finish that a newer bundle
// overtook is dropped, and the newer bundle's finish decides. `changedAt` is the last source change outside the
// bundle's own watch that no finish has started since; `stale` is set when a build script changed.
const status = { started: 0, finished: 0, bundling: true, dirty: false, generation: 0, error: /** @type {string|null} */ (null),
  bundleMs: 0, finishMs: 0, changedAt: 0, finishBegun: 0, stale: false };
/** @type {Array<() => void>} */
let waiters = [];
let lastAsked = performance.now(), bundleStarted = performance.now(), finishing = Promise.resolve();
const wake = () => { const list = waiters; waiters = []; for (const resolve of list) resolve(); };
const settled = () => !status.bundling && !status.dirty && status.finished === status.started;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

/** finishAppBuild over bundle number `bundle`, in a fresh generation folder; one at a time, in order. @param {number} bundle */
async function finish(bundle) {
  if (bundle !== status.started) return;
  const begun = performance.now(), generation = join(e2e, `gen-${String(bundle)}-${String(Date.now())}`);
  status.finishBegun = begun;
  /** @type {string|null} */
  let error = null;
  try {
    cpSync(bundleDir, generation, { recursive: true });
    // A newer bundle began while this one was copied: its own finish follows.
    if (bundle !== status.started) { rmSync(generation, { recursive: true, force: true }); return; }
    await finishAppBuild({ outDir: generation, buildId: BUILD_ID, mode: 'production', deferPublic: true });
    if (bundle === status.started) {
      // Served atomically: the link moves to the finished generation in one rename, then older ones go.
      const link = `${client}.next`;
      rmSync(link, { force: true });
      symlinkSync(basename(generation), link);
      renameSync(link, client);
      for (const name of readdirSync(e2e)) if (name.startsWith('gen-') && name !== basename(generation)) rmSync(join(e2e, name), { recursive: true, force: true });
    }
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  if (bundle !== status.started || error !== null) rmSync(generation, { recursive: true, force: true });
  if (bundle !== status.started) return;
  if (error === null) status.generation += 1;
  status.error = error; status.finished = bundle; status.finishMs = performance.now() - begun;
  wake();
}

/** Resolve once the source is quiet and the last change is built and finished. */
async function ready() {
  await sleep(SETTLE_MS);
  for (;;) {
    while (!settled()) await Promise.race([new Promise(resolve => { waiters.push(() => { resolve(undefined); }); }), sleep(250)]);
    await finishing;
    // A change the bundle didn't see (the finish's own graphs): finish the same bundle again.
    if (status.changedAt <= status.finishBegun || !settled()) break;
    const bundle = status.started;
    status.finished = bundle - 1;
    finishing = finishing.then(() => finish(bundle));
  }
}

// A fresh start owns its folders: the last watcher's bundle, generations and served link go.
for (const name of readdirSync(e2e)) if (name === 'bundle' || name.startsWith('gen-') || name.startsWith('client')) rmSync(join(e2e, name), { recursive: true, force: true });
prepareAppBuild();
const watcher = await build({
  root, configFile: join(root, 'vite.config.ts'),
  build: { outDir: bundleDir, emptyOutDir: true, watch: { chokidar: { usePolling: true, interval: 100 } } },
});
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
// What the bundle doesn't watch: source the finish builds, and the build scripts this process has loaded.
// Not the outputs other tools write under src/: the status page's build and Playwright's results.
const OUTPUTS = /^(?:dist|e2e\/test-results|e2e\/playwright-report)(?:\/|$)/u;
watch(join(root, 'src'), { recursive: true }, (_event, name) => {
  if (name !== null && !OUTPUTS.test(name)) { status.changedAt = performance.now(); console.log(`e2e-watcher: src/${name} changed`); }
});
watch(join(root, 'scripts'), { recursive: true }, (_event, name) => { if (name !== null && !name.endsWith('.json')) status.stale = true; });

await ready();
console.log(`e2e-watcher: first build ready in ${((performance.now() - started) / 1000).toFixed(1)} s`);
const preview = spawn(process.execPath, ['scripts/preview-server.mjs', '--root', root, '--outDir', client, '--host', '127.0.0.1', '--port', '0'],
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
// A dead preview server is a dead watcher: the next run starts a whole new one.
preview.once('exit', () => { void stop(1); });

/** The settled build's origin and timings, once the source is quiet and built. @param {import('node:http').ServerResponse} response */
async function answer(response) {
  const asked = performance.now();
  await ready();
  const body = { origin, outDir: client, buildId: BUILD_ID, generation: status.generation, error: status.error,
    waitedMs: performance.now() - asked, bundleMs: status.bundleMs, finishMs: status.finishMs, pid: process.pid };
  response.writeHead(status.error === null ? 200 : 500, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const control = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403).end(); return; }
  lastAsked = performance.now();
  if (url.pathname === '/ready') {
    if (status.stale || preparedKey(root) !== key) {
      response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ restart: 'inputs changed' }));
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
writeFileSync(state, `${JSON.stringify({ pid: process.pid, port: address.port, token, key, origin, outDir: client, startedMs: Date.now() })}\n`);
console.log(`e2e-watcher: control 127.0.0.1:${String(address.port)}, preview ${origin}`);

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { void stop(0); });
setInterval(() => { if (performance.now() - lastAsked > idleMs) void stop(0); }, 15_000).unref();
