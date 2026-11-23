#!/usr/bin/env node
// QA-FEEDBACK-2026-11-23 row 8 (meta): the first boot after an engine update, on headless WebKit at iPhone 17 Pro size.
// Jake: "its only frozen and really fucking slow when doing a version upgrade or update". Two builds of one tree (same
// code, two build ids, as a deploy that changes nothing a cache depends on) behind one origin: this script's proxy
// serves --from, then --to, so IndexedDB, Cache Storage and the installed service worker carry over as on the phone.
//
//   lockf -k <engine>/tmp/desktop-gpu.lock lockf -k <engine>/tmp/mini-measure.lock \
//     node scripts/loading-flow/update-boot.mjs --from http://127.0.0.1:4400 --to http://127.0.0.1:4401 [--graphics low|high]
//     [--port 4499] [--json <out.json>] [--rounds 2]
//
// Visits, one browser profile: cold on --from, warm on --from (a normal boot), the update (the origin now serves --to),
// warm on --to. Each taps ENTER THE MMO from the title and waits for control; it prints the loading card's rows as
// shown (data-key / data-ms) and the shader-source book's hits. Headless WebKit is not the phone's GPU: it measures the
// CPU-side caches (the shader-source book, the built Home geometry), never the phone's Metal compile time.
import { createServer, request as httpRequest } from 'node:http';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { webkit, devices } from '../browser-playwright.mjs';
import { saveFixture } from '../debug-settings.mjs';
import { agentUserAgent } from '../agent-marker.mjs';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, port: { type: 'string', default: '4499' },
  graphics: { type: 'string', default: 'low' }, json: { type: 'string' }, rounds: { type: 'string', default: '2' } } });
if (values.from === undefined || values.to === undefined) { console.error('usage: update-boot.mjs --from <url> --to <url> [--graphics low|high] [--port n] [--json out]'); process.exit(2); }
const from = new URL(values.from), to = new URL(values.to), port = Number(values.port);
let upstream = from;
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });

// The one origin the page sees. Pipes every request to the current upstream unchanged.
const proxy = createServer((req, res) => {
  const target = upstream;
  const out = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url,
    headers: { ...req.headers, host: `${target.hostname}:${target.port}` } }, answer => {
    res.writeHead(answer.statusCode ?? 502, answer.headers);
    answer.pipe(res);
  });
  out.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(out);
});
await new Promise(resolve => { proxy.listen(port, '127.0.0.1', () => { resolve(undefined); }); });
const base = `http://127.0.0.1:${String(port)}`;

const CONTROL = `(() => { const w = window.__wildshard?.world, l = document.querySelector('.ws-load');
  const shown = !!l && l.isConnected && l.getClientRects().length > 0 && getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
  if (window.__wsReveal?.endedMs != null && !shown) return true; // the grid entry's reveal ended: its controls (sim-grid-entry.mjs)
  try { return !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch { return false; } })()`;
// One rAF watcher a document: the loading card's rows as last shown, kept after the card leaves.
const WATCH = `window.__ubRows ??= (() => { const s = { rows: [] };
  const tick = () => { const l = document.querySelector('.ws-load');
    if (l !== null && l.isConnected && getComputedStyle(l).display !== 'none') {
      const rows = [...l.querySelectorAll('[data-key]')].map(e => [e.dataset.key, Number(e.dataset.ms), (e.children[0]?.textContent ?? '').trim()]);
      if (rows.length > 0) s.rows = rows; }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick); return s; })(); 1`;

const browser = await webkit.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 15 Pro'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 3,
  userAgent: agentUserAgent(devices['iPhone 15 Pro'].userAgent) });
await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0, music: false, sfx: false, tier: 'phone' } });
await saveFixture(context, { scope: 'device', key: 'graphics', data: values.graphics });
await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
await saveFixture(context, { scope: 'device', key: 'nameAsked', data: true });
// The 60 fps cap (meta lane rule): headless WebKit paces rAF at 60 Hz itself; a wrapped rAF stalled the boot's module step.
const page = await context.newPage();
page.setDefaultTimeout(240_000);
const until = async (/** @type {string} */ expression, /** @type {number} */ ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(expression)) return true; } catch { /* navigating */ } await sleep(250); }
  return false;
};

/** @param {string} name */
async function visit(name) {
  await page.goto(`${base}/`, { waitUntil: 'commit' });
  if (!await until(`(() => { const b = document.querySelector('.ws-main-grid'); return !!b && b.getClientRects().length > 0; })()`, 180_000)) throw new Error(`${name}: no ENTER THE MMO`);
  await sleep(4000); // the title's own prefetch and worker update start as a player's would
  const titleBuild = await page.evaluate('globalThis.__WS_BUILD_ID__ ?? null');
  const tapAt = Date.now();
  await page.evaluate(`document.querySelector('.ws-main-grid').click(); 1`);
  let reached = false;
  const end = Date.now() + 300_000;
  while (!reached && Date.now() < end) {
    try { await page.evaluate(WATCH); reached = await page.evaluate(CONTROL); } catch { /* the tap navigates */ }
    if (!reached) await sleep(100);
  }
  const ms = Date.now() - tapAt;
  if (!reached) {
    const dump = await page.evaluate(`JSON.stringify({ href: location.href, rows: window.__ubRows?.rows ?? [], error: document.querySelector('#wsstuck')?.textContent ?? document.querySelector('#wserr .msg')?.textContent ?? null,
      reveal: window.__wsReveal ?? null, world: (() => { const w = window.__wildshard?.world; try { return w ? { entered: w.hud?.entered, paused: w.hud?.paused, gate: w.game.frameGate() } : null; } catch (e) { return String(e); } })() })`).catch(String);
    if (values.json !== undefined) await page.screenshot({ path: values.json.replace(/\.json$/u, `-${name}.png`) }).catch(() => undefined);
    throw new Error(`${name}: never reached control: ${dump}`);
  }
  // the boot's own late writes first (ws:control-ready writes the book's counters, then the book; the Home geometry snapshot)
  await sleep(3000);
  const state = await page.evaluate(`JSON.stringify({ build: globalThis.__WS_BUILD_ID__ ?? null, rows: window.__ubRows?.rows ?? [],
    book: document.documentElement.dataset.shaderSourceCache ?? null,
    homeCache: performance.getEntriesByType('measure').filter(e => /:home\\.cache\\./u.test(e.name)).map(e => [e.name.split(':').at(-1), Math.round(e.duration)]),
    stages: (globalThis.__bootTiming?.read?.().entries ?? []).filter(e => e.end !== null && e.operation.startsWith('stage:')).map(e => [e.operation, Math.round(e.end - e.start)]),
    // QA row 10: the boot's kind and steps as the session summary keeps them (the saved heartbeat, telemetry/health.ts)
    vitals: (() => { const find = v => { if (v === null || typeof v !== 'object') return null; if (v.summary?.bootSteps) return v.summary;
      for (const x of Object.values(v)) { const f = find(typeof x === 'string' && x.startsWith('{') ? (() => { try { return JSON.parse(x); } catch { return null; } })() : x); if (f) return f; } return null; };
      for (const k of Object.keys(localStorage)) { try { const f = find(JSON.parse(localStorage.getItem(k))); if (f) return f; } catch {} } return null; })() })`);
  // the built-Home cache's identity row (homeBuildCache.ts): what its entries were built for
  const home = await page.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'ws-built-home-v1') ? new Promise(resolve => {
    // only an existing database: an open of a missing one would create it without its store
    const open = indexedDB.open('ws-built-home-v1');
    open.onerror = () => { resolve(null); };
    open.onsuccess = () => {
      const db = open.result;
      try {
        const store = db.transaction('geometry', 'readonly').objectStore('geometry'), head = store.get('identity'), count = store.count();
        count.onsuccess = () => { db.close(); resolve({ identity: head.result?.identity ?? null, entries: count.result }); };
        count.onerror = () => { db.close(); resolve(null); };
      } catch { db.close(); resolve(null); }
    };
  }) : null).catch(() => null);
  const result = { name, titleBuild, tapToControlMs: ms, ...JSON.parse(state), homeStore: home };
  // the boot timeline's own stage spans (the card keeps only its last rows on the grid path)
  const row = (/** @type {string} */ key) => result.stages.find((/** @type {[string, number]} */ r) => r[0] === `stage:${key}`)?.[1] ?? null;
  console.log(`update-boot ${name.padEnd(12)} build ${String(result.build)} tap→control ${(ms / 1000).toFixed(1)} s · home ${String(row('home'))} ms · homePrograms ${String(row('homePrograms'))} ms · shaders ${String(row('shaders'))} ms · book ${String(result.book)} · home cache ${JSON.stringify(result.homeCache)} · home store ${JSON.stringify(result.homeStore)}`);
  return result;
}

const results = [];
try {
  results.push(await visit('cold'));
  results.push(await visit('warm'));
  // each round moves the origin to the other build: --to, then back to --from (its caches now hold --to's build), so every
  // round reads two updates and two warm boots
  for (let round = 1; round <= Number(values.rounds); round++) for (const next of [to, from]) {
    upstream = next;
    results.push(await visit(`update-${String(round)}${next === to ? 'a' : 'b'}`));
    results.push(await visit(`warm-${String(round)}${next === to ? 'a' : 'b'}`));
  }
} finally {
  if (values.json !== undefined) writeFileSync(values.json, `${JSON.stringify({ from: values.from, to: values.to, graphics: values.graphics, results }, null, 1)}\n`);
  await browser.close();
  proxy.close();
}
