#!/usr/bin/env node
// Owns a pinned production preview and a dedicated Simulator lane. The browser posts over real HTTP to the pinned
// production API handler; only its private Blob backend is an in-memory fixture. This is delivery/behavior evidence,
// never a physical iPhone memory reading. node scripts/crossroads-rig/production-probe.mjs [--rev=HEAD] [--out=<json>]
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { saveFixtureCode } from '../debug-settings.mjs';

const ROOT = resolvePath(import.meta.dirname, '../..');
const flag = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'inherit'], ...options });
  let output = ''; child.stdout.on('data', (chunk) => { output += chunk; });
  child.on('error', reject); child.on('close', (code) => { if (code === 0) resolve(output.trim()); else reject(new Error(`${command} exited ${code}`)); });
});

function inspector(url) {
  const ws = new WebSocket(url), pending = new Map();
  let seq = 0, target = null;
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const receive = (message) => {
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result); }
  };
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Target.targetCreated' && message.params.targetInfo.type === 'page') target = message.params.targetInfo.targetId;
    else if (message.method === 'Target.didCommitProvisionalTarget') target = message.params.newTargetId;
    else if (message.method === 'Target.dispatchMessageFromTarget') receive(JSON.parse(message.params.message));
    else receive(message);
  });
  return { opened, raw: (expression) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector evaluation timed out')); }, 10000);
    pending.set(id, { timer, reject, resolve: (result) => {
      if (result.wasThrown) reject(new Error(result.result?.description ?? 'Safari evaluation threw')); else resolve(result.result?.value);
    } });
    const message = { id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } };
    ws.send(JSON.stringify(target ? { id: ++seq, method: 'Target.sendMessageToTarget', params: { targetId: target, message: JSON.stringify(message) } } : message));
  }), close() { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('Inspector closed')); } pending.clear(); ws.close(); } };
}
async function pageSocket(base) {
  const start = Date.now();
  while (Date.now() - start < 25000) {
    for (let port = 9232; port <= 9240; port++) try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
      const page = pages.find((entry) => entry.url?.startsWith(base)); if (page) return page.webSocketDebuggerUrl;
    } catch { /* Wait for the owned proxy's page discovery. */ }
    await sleep(200);
  }
  throw new Error('Owned Simulator page was not exposed by Web Inspector');
}
async function safari() {
  const udid = process.env.SIM_UDID, base = flag('base', '');
  if (!udid || !base) throw new Error('Worker requires the Simulator lane and preview URL');
  const sim = (args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const socket = sim(['getenv', udid, 'RWI_LISTEN_SOCKET']).trim();
  const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${socket}`, '-c', 'null:9221,:9232-9240', '-F'], { stdio: 'ignore' });
  let connection, currentUrl = base;
  const connect = async (url) => { connection?.close(); currentUrl = url; connection = inspector(await pageSocket(url)); await connection.opened; await sleep(500); };
  const evaluate = async (expression, url = currentUrl) => {
    try { return await connection.raw(expression); } catch (error) {
      if (!String(error).includes('timed out')) throw error;
      await connect(url); return connection.raw(expression);
    }
  };
  try {
    try { sim(['terminate', udid, 'com.apple.mobilesafari']); } catch { /* First launch. */ }
    sim(['openurl', udid, `${base}version.json`]); await connect(`${base}version.json`);
    await evaluate(`(()=>{${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })}; return true;})()`, `${base}version.json`);
    connection.close(); connection = undefined;
    const game = `${base}?chunk=_template&mute=1&skipintro=1&sw=0`;
    sim(['openurl', udid, game]); await connect(game);
    const start = Date.now();
    while (!(await evaluate('Boolean(document.querySelector(".ws-touch-pause") && !document.querySelector(".ws-load"))'))) {
      if (Date.now() - start > 90000) throw new Error('Template boot timed out'); await sleep(250);
    }
    await evaluate('document.querySelector(".ws-touch-pause").click(); true'); await sleep(500);
    await evaluate('document.querySelector(".ws-gmenu-card.debug.fold.folded .ws-gmenu-cardtitle")?.click(); true');
    // The fold selector is deliberately observed: fail instead of invoking the action function directly.
    const opened = await evaluate(`(()=>{const input=document.querySelector('.ws-dbg-filter'); if(!input || !input.getClientRects().length)return false; input.value='crossroadsRig'; input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
    if (!opened) throw new Error('Pause Settings Debug did not open');
    const clicked = await evaluate(`(()=>{const row=[...document.querySelectorAll('.ws-dbg-row')].find(r=>r.textContent.includes('Memory check')); const button=row?.querySelector('button'); if(!button || !button.getClientRects().length)return false;button.click();return true;})()`);
    if (!clicked) throw new Error('Visible production Memory check action was not reachable');
    connection.close(); connection = undefined;
    await connect(`${base}crossroads-rig/`);
    const deadline = Date.now() + 240000;
    while (!(await evaluate('Boolean(window.__crossroadsDone)', `${base}crossroads-rig/`))) {
      if (Date.now() > deadline) throw new Error('Three-run rig did not finish'); await sleep(1000);
    }
    const result = JSON.parse(await evaluate('JSON.stringify({results:window.__crossroadsResults, receipt:window.__crossroadsReceipt, error:window.__crossroadsPostError??null,status:document.getElementById("status").textContent,userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight]})', `${base}crossroads-rig/`));
    if (result.error || result.results?.length !== 3 || result.results.some((row) => row.stage !== 'complete' || !row.posted || row.overCap)) throw new Error(`Rig failed: ${JSON.stringify(result)}`);
    writeFileSync(flag('worker-out', ''), JSON.stringify({ device: udid, openedBy: 'pause Settings Debug Memory check (one click)', ...result }));
  } finally { connection?.close(); proxy.kill('SIGTERM'); }
}
async function main() {
  const sha = execFileSync('git', ['rev-parse', flag('rev', 'HEAD')], { cwd: ROOT, encoding: 'utf8' }).trim();
  const scratch = `/private/tmp/claude-501/sp-builders/sp-x1/crossroads-proof-${process.pid}`;
  mkdirSync(scratch, { recursive: true });
  const env = { ...process.env, SERVE_BUILD_DIR: join(scratch, 'serve'), CLAUDE_CODE_SESSION_ID: `sf22c-proof-${process.pid}` };
  let port, server;
  try {
    const preview = await run(join(ROOT, 'scripts/serve-build.sh'), ['--rev', sha, '--hours', '1', '--name', `sf22c-${process.pid}`], { cwd: scratch, env });
    port = new URL(preview).port;
    const row = readFileSync(join(process.env.SERVE_REG_DIR ?? join(process.env.HOME, '.dev-servers'), port), 'utf8').trim().split(' ');
    const source = join(row[2], 'src');
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const path = fileURLToPath(new URL(specifier, context.parentURL));
        if (existsSync(`${path}.ts`)) return nextResolve(pathToFileURL(`${path}.ts`).href, context);
      }
      return nextResolve(specifier, context);
    } });
    const { useBlobStore } = await import(pathToFileURL(join(source, 'api/_blobStore.ts')).href);
    const { POST, GET } = await import(pathToFileURL(join(source, 'api/telemetry.ts')).href);
    hooks.deregister();
    const blobs = new Map();
    process.env.BLOB_READ_WRITE_TOKEN = 'local-fixture'; process.env.REVIEW_PASSWORD = 'local-fixture';
    const restore = useBlobStore({
      put: (path, body) => { if (typeof body !== 'string') throw new Error('Fixture stores JSON only'); blobs.set(path, body); return Promise.resolve({}); },
      get: (path) => Promise.resolve(blobs.has(path) ? { stream: new Response(blobs.get(path)).body } : null),
      list: ({ prefix }) => Promise.resolve({ blobs: [...blobs].filter(([path]) => path.startsWith(prefix)).map(([pathname, body]) => ({ pathname, size: body.length, uploadedAt: new Date() })), hasMore: false }),
      del: (paths) => { for (const path of paths) blobs.delete(path); return Promise.resolve(); },
    });
    const respond = async (request, response) => { try {
      const url = new URL(request.url ?? '/', preview);
      let upstream;
      if (url.pathname === '/api/telemetry') {
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        upstream = await POST(new Request(url, { method: 'POST', body: Buffer.concat(chunks), headers: { 'content-type': 'application/json' } }));
      } else upstream = await fetch(url);
      response.statusCode = upstream.status;
      for (const [key, value] of upstream.headers) if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key)) response.setHeader(key, value);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { response.statusCode = 500; response.end(String(error)); } };
    server = createServer((request, response) => { void respond(request, response); });
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP fixture did not bind');
    const base = `http://127.0.0.1:${address.port}/`;
    const workerOut = join(scratch, 'worker.json');
    await run(join(ROOT, 'scripts/sim-lane.sh'), ['run', '--max', '8', 'wildshard-iphone', process.execPath, import.meta.filename, '--worker', `--base=${base}`, `--worker-out=${workerOut}`], { cwd: scratch });
    const read = await GET(new Request(`${base}api/telemetry?rig=crossroads`, { headers: { 'x-review-password': 'local-fixture' } }));
    const records = (await read.json()).records;
    const completed = records.filter((record) => record.rig?.stage === 'complete'), summary = records.find((record) => record.rig?.stage === 'summary');
    if (completed.length !== 3 || completed.some((record) => !record.rig.stats.withinCaps) || summary?.rig.summary.completed !== 3 || summary.rig.summary.posted !== 3 || summary.rig.summary.overCapRuns !== 0) throw new Error('Endpoint did not persist three runs at caps plus the summary');
    const output = resolvePath(flag('out', join(ROOT, 'progress/crossroads', `${sha.slice(0, 9)}-simulator.json`)));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ sha, version: await (await fetch(`${preview}version.json`)).json(), evidence: 'Simulator Safari -> real HTTP -> pinned production POST/GET -> local fixture private Blob backend; not physical-iPhone or OS footprint evidence', worker: JSON.parse(readFileSync(workerOut, 'utf8')), records }, null, 2)}\n`);
    console.log(`PASS: three completed Simulator runs and summary persisted; ${output}`); restore();
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); });
    if (port) await run(join(ROOT, 'scripts/serve-build.sh'), ['stop', port], { env }).catch(() => { /* Cleanup still removes the owned scratch folder. */ });
    rmSync(scratch, { recursive: true, force: true });
  }
}
await (process.argv.includes('--worker') ? safari() : main());
