#!/usr/bin/env node
// DL17 (download mini-plan, G1000): the complete-at-control gate. Jake's hard rule: the level is complete when the player
// gets control: no level content streams after control, no placeholder or far proxy stands in where the player can reach
// on foot, on the hoverboard or at boost.
//
// scripts/browser-lane.sh node scripts/complete-at-control.mjs --base=URL --rev=SHA --flow=<shard slug>|grid
//   [--engine=chromium|webkit] [--sw=on|off] [--link=none|phone] [--level-download=shardfile|packs] [--lap=<seconds>]
//   [--reach=<m, 220>] [--out=<json under ./tmp>]
//   --trace=on (Chromium): who asked for level content after control (each request's initiator stack, CDP) and every
//   `wildshard.prepare:*` measure against control on the page clock, as report.trace; not part of the verdict;
//   --dist=<the served build's dist> maps every frame through its hidden source maps
//   --frames=<s> (G1008): every rAF interval for <s> seconds from control (fps per second, worst frame, frames over 250
//   and 100 ms) as report.frames, before the lap; --profile=on (Chromium) adds the page's CPU profile over the same window
//   (self time per function and inclusive time per file, through --dist's maps); --heap=on|save (Chromium) adds a heap
//   snapshot by constructor at the window's end, 'save' also writing the raw snapshot beside the report
//   --warm=on: no lap: the cold visit, an exit and re-entry 1 s after control while the service worker's post-control
//   precache still runs (039d's trap), and a re-entry once the worker has gone quiet, each visit judged by checks 1 and 2
//
// One cold visit of a served build (`scripts/serve-build.sh --rev`), phone tier, 2x, muted iPhone 16 Pro, Developer on,
// the service worker ON by default (a fresh context, so it installs during the visit, as a player's first visit does).
// Control is the page's `ws:control-ready` plus its next frame, and the baseline snapshot is taken in that frame.
//   1. Requests and reads: every request of the context is timed on the Node side, the page's, its dedicated workers' and
//      (Chromium) the service worker's own fetches; Cache Storage matches and blob: / data: fetches of the page are logged
//      in the page. Level content is every same-origin URL that does not name another level (its hashed JS, shared code,
//      packs, common and canonical audio all count, whoever fetches it); a level-content request still open at control,
//      or any level-content request or read started after it, fails the gate. The one exception is the worker's offline
//      precache: a service-worker fetch of a URL the page never requests in the visit, lap included (listed apart).
//      With --trace=on --dist, a fetch of a URL naming no level whose every initiator stack passes through neighbour
//      or outer-road work (NEIGHBOUR_WORK's spans of the grid session) is the neighbour's (root's ruling, G872, 11-04);
//      no stack, or one from anywhere else, stays red. WebKit with the worker on is no reading:
//      Playwright WebKit reports none of the worker's fetches.
//      The server worker's own code and server class are listed apart (`isServerRead`, DL17 after the flip), and a part's
//      member fetched over the network again, by anyone, is red (DL25: report.spawnRereads, its bytes must read 0).
//   2. Completeness at control: the grid's rings (far / l1 / l0 in flight or queued, reach cells showing a far proxy,
//      tiles or near placeholders), the shardfile residency, the spawn-view fence (`wildshard.spawn-view.done` must exist
//      and wait on nothing), every texture of a shown mesh within reach decoded.
//   3. A boost lap: the hoverboard at Developer boost (56 m/s) along the level's walk legs within reach of spawn
//      (scripts/physics-route.json), sampling every 250 ms; a leg counts only when its trace passes every waypoint unstuck
//      inside its time bound. The rule is about content not downloaded and loaded at control (root's ruling, G872 (A)):
//      a mesh within reach added after control, or swapped to a geometry or texture no mesh held at control, a fine tile
//      or an undecoded texture is a pop. A shard's distance design on resident models (shown, hidden, swapped between
//      resident data, a THREE.LOD below level 0) is listed as distance LOD, not red (its distances are Jake's look and
//      perf call). The player's own viewmodel (under game.camera) and additive effects are not level content.
// Exit 0 = complete at control, 1 = the gate fails (the report lists every violation), 2 = no reading.
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { chromium, webkit, devices } from 'playwright';
import { developerSettings, saveFixture, harnessPins, hideDeveloperOverlays, levelDownloadFixtures } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { snapshot, lapLegs, lapPops, splitRequests, splitManifests, spawnRereads, neighbourSpans, splitByInitiator, NEIGHBOUR_WORK, firstSeconds, profileTop, heapTop } from './complete-at-control-snapshot.mjs';
import { execFileSync } from 'node:child_process';
import { startSharedLink } from './phone-loading/link.ts';
import { profiles } from './phone-loading/model.ts';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { readSweepTarget, requireSweepDocumentBuild } from './loading-flow/target.mjs';

// the service worker's own fetches reach context 'request' events (Chromium), as scripts/bench-load.mjs does
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS ??= '1';
const { values } = parseArgs({ options: Object.fromEntries(['base', 'rev', 'flow', 'engine', 'lap', 'out', 'reach', 'sw', 'warm', 'link', 'level-download', 'textures', 'trace', 'dist', 'frames', 'profile', 'heap', 'probe', 'device-save'].map(key => [key, { type: 'string' }])) });
const base = values.base, rev = values.rev, flow = values.flow;
if (!base || !rev || !/^[0-9a-f]{7,40}$/u.test(rev) || !flow || !/^(grid|[a-z0-9]+(?:-[a-z0-9]+)*)$/u.test(flow)) {
  console.error('usage: complete-at-control.mjs --base=URL --rev=SHA --flow=<shard slug>|grid [--engine=chromium|webkit] [--sw=on|off] [--link=none|phone] [--warm=on] [--lap=<s>] [--reach=220] [--out=tmp/<file>.json]');
  process.exit(2);
}
const engine = values.engine ?? 'chromium', reach = Number(values.reach ?? '220'), sw = values.sw ?? 'on', linkName = values.link ?? 'none';
// --lap overrides each boost-lap leg's time bound (default: the leg's length at 20 m/s plus 15 s)
const lapSeconds = Number(values.lap ?? '60');
const frameSeconds = Number(values.frames ?? '0');
// --frames is a whole number of seconds, 1 to 600: the window must end and fill whole per-second buckets (sp-x9's C12
// review: Infinity never ended, 0.5 gave no fps bucket)
if (values.frames !== undefined && !(/^[1-9][0-9]{0,2}$/u.test(values.frames) && frameSeconds <= 600)) { console.error('bad --frames: a whole number of seconds, 1 to 600'); process.exit(2); }
if (![undefined, 'shardfile', 'packs'].includes(values['level-download'])) { console.error('bad --level-download'); process.exit(2); }
// --profile and --heap read the --frames window in Chromium only: refuse a combination that would collect nothing (sp-x9)
for (const flag of ['profile', 'heap']) {
  if (values[flag] === undefined) continue;
  if (values[flag] !== 'on' && !(flag === 'heap' && values[flag] === 'save')) { console.error(`bad --${flag}`); process.exit(2); }
  if (!(Number(values.frames ?? '0') > 0) || (values.engine ?? 'chromium') !== 'chromium') { console.error(`--${flag}=on needs --frames=<s> and Chromium`); process.exit(2); }
}
// --textures=ktx2|img pins the page's texture mode (the harness pin): a texture-policy change measured on a clean build
if (![undefined, 'ktx2', 'img'].includes(values.textures)) { console.error('bad --textures'); process.exit(2); }
if (!['chromium', 'webkit'].includes(engine) || !['on', 'off'].includes(sw) || !['none', 'phone'].includes(linkName) || !(lapSeconds > 0) || !(reach > 0)) { console.error('bad --engine / --sw / --link / --lap / --reach'); process.exit(2); }
if (values.warm === 'on' && (linkName !== 'phone' || engine !== 'chromium' || sw !== 'on')) { console.error('--warm=on needs --link=phone, Chromium and the worker on: a localhost link finishes the precache before any re-entry'); process.exit(2); }
const out = resolve(values.out ?? `tmp/complete-at-control/${flow}-${rev.slice(0, 10)}-${engine}.json`);
if (!out.startsWith(`${resolve('tmp')}/`)) { console.error('--out must be under ./tmp'); process.exit(2); }
if (existsSync(resolve('.git/quiet'))) { console.error('Official Simulator quiet is active'); process.exit(2); }

/** Every level in this exact served product; author folders moved out of engine. */
let sweepTarget;
try {
  sweepTarget = await readSweepTarget(base, rev);
  if (flow !== 'grid' && !sweepTarget.slugs.has(flow)) throw new Error('Requested shard is absent from the served sweep catalogue');
} catch (error) {
  console.error(`DL17 NO READING: ${String(error)}`);
  process.exit(2);
}
const ALL_SLUGS = sweepTarget.slugs;
/** The level a URL names, or null for shared content: its shardfile files, its assets, baked files, music, sfx, horizon,
 *  an open plot's asset folder, or a Rolldown chunk named after the shard. */
function slugOf(path) {
  const named = [/^\/shardfiles\/([^/]+)\//u, /^\/assets\/(?:baked\/|music\/|sfx\/)?([^/]+)\//u, /^\/assets\/horizon\/(.+?)-(?:day|night|dusk|dawn)/u,
    /^\/assets\/shard-(.+?)-/u, /^\/assets\/boot-(.+?)-[\w]+\.json$/u];
  for (const pattern of named) {
    const slug = pattern.exec(path)?.[1];
    if (slug !== undefined && ALL_SLUGS.has(slug)) return slug;
  }
  const plot = /^\/assets\/open-plots\/([^/]+)\//u.exec(path)?.[1];
  if (plot !== undefined && ALL_SLUGS.has(`open-plot-${plot}`)) return `open-plot-${plot}`;
  // flat hashed files named after a level: its chunks (`shard-<slug>-…`) and its card art (`<slug>-…`, an open plot's `<idea>-…`)
  for (const slug of ALL_SLUGS) {
    const idea = slug.replace(/^open-plot-/u, '');
    if (path.startsWith(`/assets/shard-${slug}-`) || path.startsWith(`/assets/${slug}-`) || path.startsWith(`/assets/${idea}-`)) return slug;
  }
  return null;
}
/** The level's dependency set: every same-origin request that names no other level. In the grid the level is the home
 *  cell (filled in at control from the grid's state); the other cells and the road between them are its neighbours. */
const levelSlugs = new Set(flow === 'grid' ? [] : [flow]);
const GRID_SLUGS = new Set(JSON.parse(readFileSync(resolve('src/shared/game/grid/singleplayer.json'), 'utf8')).grid.cells.map(cell => cell.slug));
const origin = new URL(base).origin;
/** A same-origin http path that is not version.json or SHARD SELECT card art (a level's thumb, portrait and landscape
 *  cards are menu art, never drawn in the level); null otherwise. blob: and data: URLs are in-memory reads, not downloads. */
const contentPath = (url) => {
  const at = new URL(url);
  if (!at.protocol.startsWith('http') || at.origin !== origin || at.pathname === '/version.json') return null;
  if (/^\/assets\/[a-z0-9-]+?-(?:landscape|portrait)-[\w-]+\.(?:jpg|webp)$/u.test(at.pathname) || /^\/assets\/card-[\w-]+\.jpg$/u.test(at.pathname)) return null;
  return at.pathname;
};
/** Every packs manifest this visit read (DL25). */
const spawnManifests = [];
const neighbourCell = slug => flow === 'grid' && !levelSlugs.has(slug) && GRID_SLUGS.has(slug);
/** The grid's neighbour content: another cell's files, its packs and the grid road (G828: today's loading stays until Jake rules). */
const isNeighbour = (url) => {
  const at = flow === 'grid' ? contentPath(url) : null;
  if (at === null) return false;
  if (at.startsWith('/assets/grid-road/') || splitManifests(spawnManifests, neighbourCell).packs.has(at)) return true;
  const slug = slugOf(at);
  return slug !== null && !levelSlugs.has(slug) && GRID_SLUGS.has(slug);
};
const isLevelContent = (url) => {
  const at = contentPath(url);
  if (at === null || isNeighbour(url)) return false;
  const slug = slugOf(at);
  return slug === null || levelSlugs.has(slug);
};


const requests = [], reads = [];
/** The neighbour split needs the mapped trace and the served build's own session source (`git show <rev>:<file>`). */
const byWork = (rows, trace) => (trace?.mapped !== true ? { level: rows, neighbour: [] }
  : splitByInitiator(rows, trace, neighbourSpans(file => execFileSync('git', ['show', `${rev}:${file}`], { encoding: 'utf8' })), url => slugOf(contentPath(url) ?? '') !== null));
// --dist: the build's hidden source maps (dist/b/<build>/*.js.map) name each trace frame's source, as loading-benchmark does
const sourceMaps = new Map();
/** sp-x1: the maps must be the served build's own: --dist's version.json names the revision, and every map that carries a
 *  span file carries exactly that revision's source of it. Null when bound, else why not (then no frame is trusted). */
const distBinding = () => {
  if (values.dist === undefined) return 'no --dist';
  const stamp = resolve(values.dist, 'version.json'), version = existsSync(stamp) ? JSON.parse(readFileSync(stamp, 'utf8')) : null;
  if (typeof version?.build !== 'string' || !version.build.startsWith(rev.slice(0, 7))) return `--dist serves ${version?.build ?? 'no version.json'}, not ${rev}`;
  const code = resolve(values.dist, 'b', version.build), assets = existsSync(code) ? code : resolve(values.dist, 'assets');
  for (const file of new Set(NEIGHBOUR_WORK.map(span => span.file))) {
    const want = execFileSync('git', ['show', `${rev}:${file}`], { encoding: 'utf8' });
    let carried = 0;
    for (const name of readdirSync(assets).filter(entry => entry.endsWith('.js.map'))) {
      const text = readFileSync(resolve(assets, name), 'utf8');
      if (!text.includes(file)) continue;
      const map = JSON.parse(text);
      for (const [i, source] of map.sources.entries()) {
        if (!source.endsWith(file)) continue;
        if (map.sourcesContent?.[i] !== want) return `${name} maps a ${file} that is not ${rev}'s`;
        carried++;
      }
    }
    if (carried === 0) return `no map in --dist carries ${file}`;
  }
  return null;
};
/** A served frame's source (`path:line name`) through --dist's hidden maps (1-based line and column), else null. */
const sourceOf = (frame) => {
  if (values.dist === undefined) return null;
  const require = createRequire(resolve('package.json')), { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping');
  const file = /\/((?:assets|b\/[\w.-]+)\/[^?#]+\.js)/u.exec(frame.url)?.[1];
  if (file === undefined) return null;
  const path = resolve(values.dist, file);
  if (!sourceMaps.has(path)) sourceMaps.set(path, existsSync(`${path}.map`) ? new TraceMap(readFileSync(`${path}.map`, 'utf8')) : null);
  const map = sourceMaps.get(path), at = map === null ? null : originalPositionFor(map, { line: frame.line, column: Math.max(0, frame.col - 1) });
  return at?.source ? `${at.source.replace(/^(?:\.\.\/)+/u, '').replace(/^build-mirror\/check\/tree\//u, '')}:${at.line}${at.name ? ` ${at.name}` : ''}` : null;
};
const mapped = (rows) => (values.dist === undefined ? rows : rows.map(row => ({ ...row, frames: row.frames.map(frame => ({ ...frame, src: sourceOf(frame) })) })));
// --link=phone: DL0's one shared downlink (scripts/phone-loading/link.ts) at the phone preset's rate, page and service worker
// on the same proxy, loopback included (latency and CPU stay unshaped here)
const link = linkName === 'phone' ? await startSharedLink(profiles.phone.down) : null;
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'chromium'
  ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', ...(link === null ? [] : [`--proxy-server=${link.proxy}`, '--proxy-bypass-list=<-loopback>'])] : [] });
const report = { schema: 2, gate: 'DL17 complete-at-control', rev, base, flow, engine, reach, levelDownload: values['level-download'] ?? null, textures: values.textures ?? 'auto', link: link === null ? null : { preset: 'phone', bytesPerSecond: link.bytesPerSecond },
  when: new Date().toISOString(), violations: [], errors: [], limitations: ['Cache Storage and blob: / data: reads are logged on the page only, not in its dedicated workers'] };
try {
  // Playwright WebKit reports none of the service worker's own fetches: a worker-on WebKit run cannot see them, so it refuses
  if (engine === 'webkit' && sw === 'on') throw new Error('WebKit with the service worker on: Playwright reports no worker fetches, so no reading (use --sw=off for a page-only WebKit pass)');
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], viewport: { width: 402, height: 874 } });
  await developerSettings(context, { tier: 'phone', volume: 0 });
  await saveFixture(context, { scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } });
  // DL16's Debug ▸ Loading & memory ▸ Level download (src/client/engine/boot/loadingPacks.ts), read once at boot
  if (values['level-download'] !== undefined) for (const fixture of levelDownloadFixtures(values['level-download'])) await saveFixture(context, fixture);
  // --device-save=<key>=<value>: a Debug row's device slot before boot (a row's A / B with a probe; used for D227's mip probe)
  if (values['device-save'] !== undefined) {
    const at = values['device-save'].indexOf('=');
    if (at < 1) { console.error('bad --device-save (key=value)'); process.exit(2); }
    await saveFixture(context, { scope: 'device', key: values['device-save'].slice(0, at), data: values['device-save'].slice(at + 1) });
  }
  await context.addInitScript(hideDeveloperOverlays);
  await harnessPins(context, { seed: 357, browser: `${engine} / iPhone 16 Pro`, lane: 'dl17', sha: rev, ...(values.textures === undefined ? {} : { textures: values.textures }) });
  const control = { at: null };
  // --profile: the page's CPU from the control frame on (CDP Profiler, Chromium), for the first seconds of play (G1008)
  let profiler = null;
  await context.exposeBinding('__dl17Control', () => { control.at ??= Date.now(); void profiler?.send('Profiler.start').catch(() => undefined); });
  // the baseline is the control frame itself: the snapshot runs in it, before the binding returns to Node
  await context.addInitScript({ content: `window.__dl17Reach = ${JSON.stringify(reach)}; window.__dl17Snapshot = ${snapshot.toString()};` });
  // --frames=<s> (G1008, Jake: 'how quickly can you play and how smoothly in the first 30 seconds after the loading screen'):
  // every rAF interval from the control event on, for that long
  if (frameSeconds > 0) await context.addInitScript({ content: `(() => {
    const frames = []; Object.defineProperty(window, '__dl17Frames', { value: frames });
    document.addEventListener('ws:control-ready', () => {
      const start = performance.now(); let last = start;
      const tick = now => { frames.push([Math.round(last - start), Math.round((now - last) * 10) / 10]); last = now; if (now - start < ${frameSeconds * 1000}) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, { once: true });
  })();` });
  await context.addInitScript(() => {
    document.addEventListener('ws:control-ready', () => {
      requestAnimationFrame(() => {
        Reflect.set(window, '__dl17ControlNow', performance.now());
        Reflect.set(window, '__dl17AtControl', Reflect.apply(Reflect.get(window, '__dl17Snapshot'), window, []));
        Reflect.apply(Reflect.get(window, '__dl17Control'), window, []);
      });
    }, { once: true });
  });
  // the page's reads that reach no network: Cache Storage matches and blob: / data: fetches, timed by the page's clock
  await context.addInitScript(() => {
    const log = []; Object.defineProperty(window, '__dl17Reads', { value: log });
    const urlOf = what => (typeof what === 'string' ? what : what instanceof URL ? what.href : String(what?.url ?? what));
    const wrap = (proto, name, kind) => {
      const original = proto?.[name];
      if (typeof original !== 'function') return;
      Object.defineProperty(proto, name, { configurable: true, writable: true, value(...args) { log.push({ kind, url: urlOf(args[0]).slice(0, 200), at: Date.now() }); return Reflect.apply(original, this, args); } });
    };
    wrap(globalThis.CacheStorage?.prototype, 'match', 'cache');
    wrap(globalThis.Cache?.prototype, 'match', 'cache');
    wrap(globalThis.Cache?.prototype, 'matchAll', 'cache');
    const fetchOriginal = window.fetch;
    window.fetch = function fetch(input, init) {
      const url = urlOf(input);
      if (/^(?:blob|data):/u.test(url)) log.push({ kind: 'blob-data', url: url.slice(0, 80), at: Date.now() });
      return Reflect.apply(fetchOriginal, this, [input, init]);
    };
  });
  // the whole context's requests: the page's, its dedicated workers' and the service worker's own fetches
  const open = new Map();
  context.on('request', req => {
    const row = { url: req.url(), start: Date.now(), end: null, failed: null, by: req.serviceWorker() === null ? 'page' : 'service-worker' };
    open.set(req, row); requests.push(row);
  });
  // the encoded body bytes each request moved (Playwright's transfer sizes; a cache or worker answer moves none over the wire)
  context.on('requestfinished', req => {
    const row = open.get(req); if (!row) return; row.end = Date.now();
    void (async () => { const [size, response] = await Promise.all([req.sizes(), req.response()]); row.bytes = response?.fromServiceWorker() === true ? 0 : size.responseBodySize; })().catch(() => undefined);
  });
  context.on('requestfailed', req => { const row = open.get(req); if (row) { row.end = Date.now(); row.failed = req.failure()?.errorText ?? 'failed'; } });
  // DL1: code the document names is shell (the worker installs it); any other code before control is the precache running early
  const shellDocument = await (await fetch(base)).text();
  context.on('response', response => {
    if (!/\/assets\/spawn\/[^/]+\.json(?:\?|$)/u.test(response.url())) return;
    void (async () => { const manifest = await response.json(); spawnManifests.push({ at: Date.now(), path: new URL(response.url()).pathname, manifest }); })().catch(() => undefined);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(240000);
  if (values.profile === 'on' && engine === 'chromium') {
    profiler = await context.newCDPSession(page);
    await profiler.send('Profiler.enable'); await profiler.send('Profiler.setSamplingInterval', { interval: 500 });
  }
  const initiators = [], workers = [];
  if (values.trace === 'on' && engine === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Runtime.enable');
    // async parents too (an awaited read's caller), bounded: a trace run is not a timed reading
    await cdp.send('Debugger.enable'); await cdp.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 }); await cdp.send('Runtime.setAsyncCallStackDepth', { maxDepth: 32 });
    const framesOf = (stack) => {
      const frames = [];
      for (let at = stack; at !== undefined && frames.length < 48; at = at.parent)
        for (const frame of at.callFrames) if (frames.length < 48) frames.push({ fn: frame.functionName, url: frame.url, line: frame.lineNumber + 1, col: frame.columnNumber + 1, ...(at.description === undefined ? {} : { async: at.description }) });
      return frames;
    };
    cdp.on('Network.requestWillBeSent', ({ request, initiator }) => {
      if (control.at === null || !isLevelContent(request.url)) return;
      initiators.push({ url: request.url, msAfterControl: Date.now() - control.at, type: initiator.type, frames: framesOf(initiator.stack) });
    });
    // a worker's script fetch carries no initiator stack: its constructor's call (and async parents) stands for it
    cdp.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
      if (type !== 'debug' || args[0]?.value !== '[dl17-worker]' || typeof args[1]?.value !== 'string') return;
      workers.push({ url: args[1].value, msAfterControl: control.at === null ? null : Date.now() - control.at, frames: framesOf(stackTrace) });
    });
    await context.addInitScript(() => {
      for (const name of ['Worker', 'SharedWorker']) {
        const Original = Reflect.get(window, name);
        if (typeof Original !== 'function') continue;
        Reflect.set(window, name, new Proxy(Original, { construct(target, args, newTarget) {
          console.debug('[dl17-worker]', new URL(String(args[0]), location.href).href);
          return Reflect.construct(target, args, newTarget);
        } }));
      }
    });
  }
  page.on('pageerror', error => report.errors.push(error.message));
  const version = await (await fetch(new URL('/version.json', base))).json();
  if (version.build !== sweepTarget.build) throw new Error('Served build changed after sweep catalogue collection');
  report.build = version.build;
  // the grid's title route (frame-floor's, but with the worker on unless --sw=off) or the shard's direct chunk route
  const url = new URL('/', base);
  const query = flow === 'grid' ? { mute: '1', nolock: '1' } : { chunk: flow, tier: 'phone', skipintro: '1', nolock: '1', mute: '1' };
  for (const [key, value] of Object.entries({ ...query, ...(sw === 'off' ? { sw: '0' } : {}) })) url.searchParams.set(key, value);
  report.sw = sw; report.url = url.href;
  const workerOpen = () => requests.filter(r => r.by === 'service-worker' && r.end === null).length;
  /** The current document's logged reads, before it goes. */
  const harvest = async () => { try { reads.push(...await page.evaluate(() => Reflect.get(window, '__dl17Reads') ?? [])); } catch { /* no document yet */ } };
  /** One visit from navigation to control (the grid by its title tap and the HUD's own entry, the goldens' route). */
  const enter = async () => {
    await harvest();
    control.at = null;
    const workerFetchesOpenAtNavigation = workerOpen(), start = Date.now();
    await page.goto(url.href, { waitUntil: 'load' });
    await requireSweepDocumentBuild(page, sweepTarget.build);
    if (flow === 'grid') {
      await page.locator('.ws-main-grid').click();
      await page.waitForFunction(() => window.__wildshard?.shard?.grid?.state().live.live.gameplayReady === true, undefined, { timeout: 240000 });
      await page.evaluate(FLOOR_GRID_ENTER);
    }
    await page.waitForFunction(() => window.__wildshard?.world?.hud?.entered === true, undefined, { timeout: 240000 });
    const deadline = Date.now() + 30000;
    while (control.at === null && Date.now() < deadline) await page.waitForTimeout(100);
    if (control.at === null) throw new Error('No ws:control-ready within 30 s of entry');
    const at = await page.evaluate(() => Reflect.get(window, '__dl17AtControl') ?? null);
    if (at === null) throw new Error('No snapshot from the control frame');
    await requireSweepDocumentBuild(page, sweepTarget.build);
    // control is the control frame's own clock (the snapshot's Date.now()), not the binding's later arrival in Node: a request
    // that starts between the two is after control
    const controlFrame = typeof at.when === 'number' ? Math.min(at.when, control.at) : control.at;
    return { start, control: controlFrame, ms: controlFrame - start, workerFetchesOpenAtNavigation, at };
  };
  /** The grid's reach cells (each cell whose square meets the lap's box round spawn; a cell's centre is its index times the
   *  pitch); the home cell joins the level's dependency set. */
  const reachOf = at => {
    const g = at.grid;
    if (flow !== 'grid' || !g || g.error) return [];
    const half = g.pitch / 2, fx = g.feet.x, fz = g.feet.z;
    const inReach = (g.cells ?? []).filter(c => Math.abs(c.cell[0] * g.pitch - fx) < half + reach && Math.abs(c.cell[1] * g.pitch - fz) < half + reach);
    const home = (g.cells ?? []).find(c => c.id === g.home);
    if (home !== undefined) levelSlugs.add(home.slug);
    return inReach.map(c => ({ id: c.id, slug: c.slug, shows: c.shows }));
  };
  const path = r => new URL(r.url).pathname;
  const waiting = detail => (Array.isArray(detail) ? detail.reduce((n, q) => n + (Number(q?.waiting) || 0), 0) : Number(detail?.waiting) || 0);
  /** Every pending count or full-LOD flag the shardfile residency reports, as `path=value`. */
  const residencyOpen = (value, at = 'residency', found = []) => {
    if (value === null || typeof value !== 'object') return found;
    for (const [key, inner] of Object.entries(value)) {
      if (/^(?:waiting|pending|inFlight|queued|texturesPending)$/u.test(key) && typeof inner === 'number' && inner > 0) found.push(`${at}.${key}=${inner}`);
      else if (key === 'fullLod' && inner === false) found.push(`${at}.fullLod=false`);
      else residencyOpen(inner, `${at}.${key}`, found);
    }
    return found;
  };
  /** Checks 1 and 2 for one visit (its requests and reads from its navigation to `until`), and check 3 for its lap. In the
   *  grid the verdict is the home cell's: its own and shared content. What the neighbour cells load (their files, the grid
   *  road, the rings, their stand-ins and draws) keeps today's loading pending Jake (G828) and is listed apart. */
  const judge = (name, visit, until, reachCells, lap = []) => {
    const flag = text => { report.violations.push(name === '' ? text : `${name}: ${text}`); };
    const neighbourList = [], note = text => { neighbourList.push(name === '' ? text : `${name}: ${text}`); };
    const c = visit.control, at = visit.at, row = r => ({ url: r.url, by: r.by, msAfterControl: r.start - c });
    // the worker's offline precache is listed apart (splitRequests: root's ruling, G872 (a)); any page request stays red
    const mine = requests.filter(r => r.start >= visit.start && r.start < until), { level, precache, server } = splitRequests(mine, isLevelContent);
    const { members, listedAt } = splitManifests(spawnManifests, neighbourCell);
    const rereads = spawnRereads(mine, members, listedAt, mine.some(r => r.url.includes('/assets/spawn/parts/') && r.failed !== null));
    if (rereads.files > 0) flag(`${rereads.files} files the parts already delivered moved over the network again, ${(rereads.bytes / 1e6).toFixed(2)} MB (first: ${rereads.first.join(', ')})`);
    const pending = level.filter(r => r.start < c && (r.end === null || r.end > c));
    // --trace with --dist: a shared fetch only neighbour work asked for is the neighbour's (root's ruling, G872)
    const { level: after, neighbour: byInitiator } = byWork(level.filter(r => r.start >= c), report.trace);
    const lateReads = reads.filter(r => r.at >= c && r.at < until && (r.kind === 'blob-data' || isLevelContent(r.url)));
    if (pending.length > 0) flag(`${pending.length} level-content requests still open at control (first: ${pending.slice(0, 3).map(path).join(', ')})`);
    if (after.length > 0) flag(`${after.length} level-content requests started after control, ${after.filter(r => r.by === 'service-worker').length} by the service worker (first: ${after.slice(0, 3).map(path).join(', ')})`);
    if (lateReads.length > 0) flag(`${lateReads.length} Cache Storage / blob / data reads of level content after control (first: ${lateReads.slice(0, 3).map(r => `${r.kind} ${r.url}`).join(', ')})`);
    const nPending = mine.filter(r => isNeighbour(r.url) && r.start < c && (r.end === null || r.end > c)), nAfter = mine.filter(r => isNeighbour(r.url) && r.start >= c);
    const nReads = reads.filter(r => r.at >= c && r.at < until && isNeighbour(r.url));
    if (nPending.length + nAfter.length > 0) note(`${nPending.length} neighbour requests open at control, ${nAfter.length} started after it (first: ${[...nPending, ...nAfter].slice(0, 3).map(path).join(', ')})`);
    if (byInitiator.length > 0) note(`${byInitiator.length} shared fetches after control initiated by neighbour work (--trace): ${[...new Set(byInitiator.map(r => `${path(r)} (${r.work})`))].slice(0, 6).join(', ')}`);
    if (nReads.length > 0) note(`${nReads.length} Cache Storage reads of neighbour content after control (first: ${nReads.slice(0, 2).map(r => r.url).join(', ')})`);
    const g = at.grid;
    if (g && !g.error) {
      // the ring streamer feeds the cells round the one being played (home draws its own scene, 0 ring tiles at control)
      const rings = g.rings ?? {};
      if ((rings.inFlight ?? 0) > 0 || (rings.queued ?? 0) > 0) note(`grid rings at control: ${rings.inFlight ?? 0} in flight, ${rings.queued ?? 0} queued`);
      const reachIds = new Set(reachCells.map(cell => cell.id));
      const standIns = (g.cells ?? []).filter(cell => reachIds.has(cell.id) && ['far proxy', 'tiles', 'loading', 'near', 'frozen'].includes(cell.shows));
      const homeStandIn = standIns.filter(cell => cell.id === g.home), nStandIns = standIns.filter(cell => cell.id !== g.home);
      if (homeStandIn.length > 0) flag(`the home cell stands in at control: ${homeStandIn.map(cell => `${cell.id}=${cell.shows}`).join(', ')}`);
      if (nStandIns.length > 0) note(`neighbour cells within reach standing in at control: ${nStandIns.map(cell => `${cell.id}=${cell.shows}`).join(', ')}`);
    }
    const done = at.marks.findLast(m => m.name === 'wildshard.spawn-view.done');
    if (done === undefined) flag('no wildshard.spawn-view.done mark at control: the spawn-view fence never finished, completeness unproven');
    else if (waiting(done.detail) > 0) flag(`spawn-view fence still waiting at control: ${waiting(done.detail)} jobs`);
    const openResidency = residencyOpen(at.residency);
    if (openResidency.length > 0) flag(`shardfile residency open at control: ${openResidency.slice(0, 6).join(', ')}`);
    if (at.scene?.error !== undefined) flag(`no scene at control: ${at.scene.error}`);
    if ((at.scene?.texturesPending ?? []).length > 0) flag(`${at.scene.texturesPending.length} textures of shown meshes within reach not decoded at control (first: ${at.scene.texturesPending.slice(0, 3).join(', ')})`);
    // Auto (src/client/engine/boot/gpuFiles.ts) fixes a page's texture mode at boot: a level drawn with images because its KTX2 set
    // is not cached yet downloads that set after control and the next visit draws other textures (sp-x6's DL9 red)
    if (at.textures?.mode === 'img' && /KTX2 set is not cached/u.test(at.textures.why ?? '')) flag(`textures drawn as images at control while the level's KTX2 set downloads after it, so the next visit swaps them (${at.textures.why})`);
    // a THREE.LOD below level 0 is the shard's distance design on resident models (root's ruling, G872 (A)): listed by the lap
    if (lap.length > 0) {
      const found = lapPops(at, lap, flow === 'grid' ? (g?.cells ?? []).find(cell => cell.id === g?.home)?.id : undefined);
      if (found.fine.length > 0) flag(`${found.fine.length} fine tiles became resident during the boost lap`);
      if (found.pops.length > 0) flag(`${found.pops.length} meshes popped within reach during the boost lap: ${found.pops.slice(0, 6).join('; ')}`);
      if (found.neighbourPops.length > 0) note(`${found.neighbourPops.length} neighbour meshes popped within reach during the boost lap: ${found.neighbourPops.slice(0, 4).join('; ')}`);
      // distance LOD (resident models shown, hidden or swapped between resident data; LOD levels): listed, not red
      if (found.distanceLod.length + found.lods.length > 0) (report.distanceLod ??= []).push(...found.distanceLod, ...found.lods.map(lod => `LOD ${lod}`));
      // the Shardfile ring's in-play re-attachments: a DL5 target (root, G872), listed, not in the verdict
      if (found.reattached.length > 0) (report.ringReattached ??= []).push(...found.reattached);
      if (found.textures.length > 0) flag(`${found.textures.length} textures within reach not decoded during the boost lap (first: ${found.textures.slice(0, 3).join(', ')})`);
      // grid tiles join batched meshes, so a ring pop shows as a reach cell's drawn layers changing, not as a new mesh
      const lapReach = new Set(reachCells.map(cell => cell.id)), drawnAt = new Map((g?.cells ?? []).map(cell => [cell.id, cell.drawn])), cellPops = new Map();
      for (const s of lap) for (const cell of s.grid?.cells ?? []) {
        const before = drawnAt.get(cell.id);
        if (!lapReach.has(cell.id) || before === undefined || cell.drawn === undefined) continue;
        if (cell.drawn.l0 > before.l0 || cell.drawn.l1 > before.l1 || cell.drawn.far !== before.far || cell.drawn.near !== before.near) {
          cellPops.set(cell.id, `${cell.id}: l0 ${before.l0}->${cell.drawn.l0}, l1 ${before.l1}->${cell.drawn.l1}, far ${before.far}->${cell.drawn.far}, near ${before.near}->${cell.drawn.near}`);
        }
      }
      const homePops = [...cellPops].filter(([id]) => id === g?.home).map(([, text]) => text), nCellPops = [...cellPops].filter(([id]) => id !== g?.home).map(([, text]) => text);
      if (homePops.length > 0) flag(`the home cell changed what it draws during the boost lap: ${homePops.join('; ')}`);
      if (nCellPops.length > 0) note(`neighbour cells changed what they draw during the boost lap: ${nCellPops.join('; ')}`);
      report.lapAdds = { fineTiles: found.fine, meshesAtControl: at.scene?.meshes ?? null, pops: found.pops, distanceLod: found.distanceLod, reattached: found.reattached, neighbourPops: found.neighbourPops, actorsShown: found.actors, lods: found.lods, textures: found.textures, cellPops: [...cellPops.values()] };
    }
    if (neighbourList.length > 0) (report.neighbour ??= []).push(...neighbourList);
    return { tapToControlMs: visit.ms, beforeControl: mine.filter(r => r.start < c).length, bytesBeforeControl: mine.filter(r => r.start < c).reduce((sum, r) => sum + (r.bytes ?? 0), 0), level: level.length, byServiceWorker: mine.filter(r => r.by === 'service-worker').length,
      pendingAtControl: pending.map(r => ({ url: r.url, by: r.by, msBeforeControl: c - r.start, msAfterControl: r.end === null ? null : r.end - c, failed: r.failed })), afterControl: after.map(row), neighbourWorkAfterControl: byInitiator.map(r => Object.assign(row(r), { work: r.work })), readsAfterControl: lateReads.slice(0, 40),
      precacheAfterControl: precache.filter(r => r.start >= c).length, precacheOpenAtControl: precache.filter(r => r.start < c && (r.end === null || r.end > c)).length,
      // DL1: what the service worker fetched for itself before control: shell files only (the code waits for control)
      precacheBeforeControl: precache.filter(r => r.start < c).map(path), spawnRereads: rereads,
      codeBeforeControl: precache.filter(r => r.start < c).map(path).filter(file => file.startsWith('/b/') && !shellDocument.includes(file)),
      serverReads: { beforeControl: server.filter(r => r.start < c).length, afterControl: server.filter(r => r.start >= c).length, bytes: server.reduce((sum, r) => sum + (r.bytes ?? 0), 0) },
      neighbour: { pendingAtControl: nPending.length, afterControl: nAfter.length, readsAfterControl: nReads.length },
      otherAfterControl: mine.filter(r => r.start >= c && !isLevelContent(r.url) && !isNeighbour(r.url)).map(r => ({ url: r.url, by: r.by })) };
  };
  const strip = s => { if (s?.scene) delete s.scene.list; return s; };

  const cold = await enter();
  report.tapToControlMs = cold.ms;
  // --probe=<file.js> (D227): a page script evaluated in the control frame's wake; whatever its window.__dl17ProbeResult()
  // returns at the end of the --frames window lands in report.frames.probe (a measurement hook, never part of the verdict)
  if (values.probe !== undefined) await page.evaluate(readFileSync(values.probe, 'utf8'));
  if (frameSeconds > 0) {
    // the first seconds of play, before the lap moves the player (G1008): fps per second, the worst frames
    const until = (control.at ?? Date.now()) + frameSeconds * 1000 + 500;
    while (Date.now() < until) await page.waitForTimeout(250);
    const frames = await page.evaluate(() => Reflect.get(window, '__dl17Frames') ?? []);
    report.frames = firstSeconds(frames, frameSeconds);
    if (profiler !== null) report.frames.profile = profileTop((await profiler.send('Profiler.stop')).profile, sourceOf);
    if (values.probe !== undefined) report.frames.probe = await page.evaluate(() => Reflect.get(window, '__dl17ProbeResult')?.() ?? null);
    // --heap=on (Chromium, D227): the page's JS heap at the end of the window, self size by constructor (top 30)
    if ((values.heap === 'on' || values.heap === 'save') && engine === 'chromium') {
      const cdp = await context.newCDPSession(page), chunks = [];
      cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => { chunks.push(chunk); });
      await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      report.frames.heap = heapTop(JSON.parse(chunks.join('')));
      // --heap=save: the raw snapshot beside the report, for retainer analysis (which objects own the ArrayBuffers)
      if (values.heap === 'save') writeFileSync(`${out.replace(/\.json$/u, '')}.heapsnapshot`, chunks.join(''));
    }
  }
  const reachCells = reachOf(cold.at);
  report.reachCells = reachCells;
  if (values.warm === 'on') {
    // 039d-style warm check (sp-x6's risk): exit and re-enter while the post-control precache still runs, then again once
    // the worker has gone quiet; every visit is judged complete at control, and 'warm no slower' is read from the timings
    await page.waitForTimeout(1000);
    const during = await enter();
    // the case counts only if the precache is really running when the player comes back (counted as the navigation starts)
    if (during.workerFetchesOpenAtNavigation === 0) report.errors.push('no service-worker fetch was open at the re-entry: the mid-precache return was not exercised');
    const quietBy = Date.now() + 180000;
    let quiet = false;
    for (;;) {
      const lastStart = Math.max(0, ...requests.filter(r => r.by === 'service-worker').map(r => r.start));
      if (workerOpen() === 0 && Date.now() - lastStart > 5000) { quiet = true; break; }
      if (Date.now() > quietBy) break;
      await page.waitForTimeout(500);
    }
    if (!quiet) report.errors.push(`the service worker never went quiet within 180 s (${workerOpen()} fetches open): no settled re-entry`);
    const settled = await enter();
    await page.waitForTimeout(5000);
    await harvest();
    report.warm = { coldMs: cold.ms, duringPrecacheMs: during.ms, workerFetchesOpenAtReentry: during.workerFetchesOpenAtNavigation, settledMs: settled.ms,
      workerFetchesOpenAtSettled: settled.workerFetchesOpenAtNavigation, workerBytesRequests: requests.filter(r => r.by === 'service-worker').length };
    report.visits = { cold: judge('cold', cold, during.start, reachCells), duringPrecache: judge('during precache', during, settled.start, reachCells), settled: judge('settled', settled, Infinity, reachCells) };
    const modes = [cold, during, settled].map(visit => visit.at.textures?.mode ?? null);
    if (new Set(modes).size > 1) report.violations.push(`the texture mode changed between visits (cold, during precache, settled: ${modes.join(', ')}): a texture swap the player sees`);
    report.atControl = { cold: strip(cold.at), duringPrecache: strip(during.at), settled: strip(settled.at) };
  } else {
    // J130's row starts its server after control; a harness move before it is up would never reach the server. The flip has none of this wait.
    if (values['device-save']?.startsWith('debug.workerClient=') === true) await page.waitForFunction(() => typeof Reflect.get(window, '__workerClient') === 'function', undefined, { timeout: 60_000 });
    // the boost lap: the level's own walk legs (scripts/physics-route.json: courses known to be drivable) that start within
    // `reach` of spawn, each driven on the hoverboard at Developer boost; the grid drives its home cell's legs, moved by the
    // cell's offset (a cell's centre is its index times the pitch)
    const lap = [], gridAt = cold.at.grid;
    const homeCell = flow === 'grid' ? (gridAt?.cells ?? []).find(cell => cell.id === gridAt.home) : undefined;
    const homeSlug = flow === 'grid' ? homeCell?.slug : flow;
    const [ox, oz] = homeCell === undefined ? [0, 0] : [homeCell.cell[0] * gridAt.pitch, homeCell.cell[1] * gridAt.pitch];
    const [px, , pz] = cold.at.scene?.player ?? [ox, 0, oz];
    const allLegs = JSON.parse(readFileSync(resolve('scripts/physics-route.json'), 'utf8'))[homeSlug ?? ''] ?? [];
    const { legs, skipped } = lapLegs(allLegs, [ox, oz], [px, pz], reach);
    if (legs.length === 0) throw new Error(`No walk leg of ${homeSlug} starts within ${reach} m of spawn: the boost lap needs scripts/physics-route.json`);
    report.lapRoute = { slug: homeSlug, legs: [], skipped };
    report.lapResults = [];
    for (const leg of legs) {
      let metres = 0;
      for (let i = 0, from = [leg.start.x, leg.start.z]; i < leg.points.length; from = leg.points[i], i++) metres += Math.hypot(leg.points[i][0] - from[0], leg.points[i][1] - from[1]);
      // its time bound: the leg at 10 m/s on the board (a walk course turns often, wades, climbs), 4 m/s on foot, plus 15 s, so only a stuck
      // run runs out of time
      const bound = hover => (values.lap === undefined ? Math.ceil(metres / (hover ? 10 : 4) + 15) : lapSeconds);
      /** One run of the leg; a run counts only when it is driven (sp-x1's review: a timed-out drive is no lap): its trace
       *  (each frame's waypoint index, column 9) passes every waypoint in order, nothing stuck (walkLeg teleports past a stuck
       *  waypoint), inside its time bound, and it ends at the last waypoint. */
      const drive = async hover => {
        const seconds = bound(hover);
        const boost = leg.boost ?? true;
        if (hover) await page.evaluate(on => { window.__wildshard.requireWorld().player.hoverBoost = on; }, boost);
        const walk = page.evaluate(l => window.__wildshard.walkLeg({ name: `dl17-${l.name}`, start: { ...l.start, hover: l.hover }, waypoints: l.points.map(([x, z]) => ({ x, z })), timeout: l.seconds, stuckSeconds: 5 }), { ...leg, seconds, hover });
        const first = lap.length, legEnd = Date.now() + seconds * 1000 + 2000, finished = { done: false };
        const settledWalk = (async () => {
          try { return await walk; } catch (error) { report.errors.push(`lap ${leg.name}: ${String(error)}`); return null; } finally { finished.done = true; }
        })();
        await page.waitForTimeout(300);
        if (hover) await page.evaluate(on => { window.__wildshard.requireWorld().player.hoverBoost = on; }, boost); // walkLeg's start pose may reset the board
        while (!finished.done && Date.now() < legEnd) { lap.push(await page.evaluate(snapshot)); await page.waitForTimeout(250); }
        const result = await settledWalk, mine = lap.slice(first).map(s => s.scene ?? {});
        // what the board did: its top speed (samples, and the trace frame to frame), boost and any speed cap it ran under
        let traceTop = 0;
        for (let i = 1; i < (result?.trace ?? []).length; i++) { const [t0, x0, , z0] = result.trace[i - 1], [t1, x1, , z1] = result.trace[i]; if (t1 > t0) traceTop = Math.max(traceTop, Math.hypot(x1 - x0, z1 - z0) / (t1 - t0)); }
        const board = { top: Math.max(0, ...mine.map(s => s.speed ?? 0)), traceTop, hover: [...new Set(mine.map(s => s.hover))], boost: [...new Set(mine.map(s => s.boost))], limit: [...new Set(mine.map(s => s.limit))] };
        const trace = result?.trace ?? [], passed = new Set(trace.map(frame => frame[9]));
        const ordered = trace.every((frame, i) => i === 0 || frame[9] >= trace[i - 1][9]);
        const [lx, lz] = leg.points.at(-1) ?? [leg.start.x, leg.start.z];
        const off = result?.end === undefined ? Infinity : Math.hypot(result.end.x - lx, result.end.z - lz);
        const stuck = (result?.stuck ?? []).length;
        const complete = result !== null && trace.length > 0 && ordered && leg.points.every((_, i) => passed.has(i)) && stuck === 0 && result.seconds < seconds && off <= 3;
        return { leg: leg.name, on: hover ? 'board' : 'foot', boost: hover && boost, complete, board, frames: trace.length, waypointsPassed: passed.size, of: leg.points.length, stuck, stuckAt: result?.stuck ?? [], maxY: result?.maxY ?? null, seconds: result?.seconds ?? null, bound: seconds, end: result?.end ?? null, offEnd: Number.isFinite(off) ? Math.round(off * 10) / 10 : null };
      };
      report.lapRoute.legs.push({ leg: leg.name, waypoints: leg.points.length, metres: Math.round(metres) });
      // a walk course the board cannot climb (stairs, ladders) is driven again on foot: the player reaches it that way
      const runs = [await drive(true)];
      if (!runs[0].complete) runs.push(await drive(false));
      const run = runs.at(-1);
      report.lapResults.push(...runs);
      if (!run.complete) report.errors.push(`the boost lap's ${leg.name} leg did not complete on board or on foot: ${run.waypointsPassed} of ${run.of} waypoints in its trace, ${run.stuck} stuck, ended ${run.offEnd === null ? 'with no result' : `${run.offEnd} m from its last waypoint`}, ${run.seconds?.toFixed(1) ?? '?'} of ${run.bound} s`);
    }
    report.lapComplete = legs.every(leg => report.lapResults.some(r => r.leg === leg.name && r.complete));
    // boost is proven engaged (every board sample: Developer boost on, a cap of none or the grid interior 14 m/s, so a 56 m/s
    // top, src/shared/engine/player/hoverSpeed.ts); the speed
    // travelled is the course's (frame to frame in the trace: a velocity sample reads 56 against a wall it is stuck on)
    // the route's no-boost legs (`lap.boost: false`, D226) drive the board at normal speed: they never count as the boost proof
    const boardRuns = report.lapResults.filter(r => r.on === 'board' && r.boost !== false);
    const engaged = boardRuns.length > 0 && boardRuns.every(r => r.board.boost.every(Boolean) && r.board.hover.includes(true) && r.board.limit.every(l => l === null || l <= 14));
    report.boost = { engaged, travelledTop: Math.max(0, ...boardRuns.map(r => r.board.traceTop)) };
    if (!engaged) report.errors.push(`boost never engaged on the board: ${JSON.stringify(boardRuns.map(r => ({ leg: r.leg, hover: r.board.hover, boost: r.board.boost, limit: r.board.limit })))}`);
    report.lapSamples = lap.length;
    lap.push(await page.evaluate(snapshot));
    await harvest();
    if (values.trace === 'on') report.trace = { initiators: mapped(initiators), workers: mapped(workers.filter(w => w.msAfterControl !== null)), mapped: (report.traceBinding = distBinding()) === null, measures: await page.evaluate(() => {
      const at = Reflect.get(window, '__dl17ControlNow');
      return performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('wildshard.prepare'))
        .map(entry => ({ name: entry.name, msFromControl: Math.round(entry.startTime - at), ms: Math.round(entry.duration) }));
    }) };
    report.requests = judge('', cold, Infinity, reachCells, lap);
    report.atControl = strip(cold.at);
    report.afterLap = strip(lap.at(-1));
    for (const s of lap) strip(s);
  }
  report.pass = report.errors.length > 0 ? null : report.violations.length === 0;
} catch (error) {
  report.errors.push(String(error)); report.pass = null;
} finally {
  await browser.close();
  if (link !== null) { report.link.errors = link.errors.slice(0, 10); await link.close(); }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
}
const timing = report.warm === undefined ? '' : ` (warm: cold ${report.warm.coldMs} ms, re-entry during precache ${report.warm.duringPrecacheMs} ms with ${report.warm.workerFetchesOpenAtReentry} worker fetches open, settled ${report.warm.settledMs} ms)`;
const verdict = `${report.pass ? 'COMPLETE AT CONTROL' : 'FAIL'}${timing}`;
console.log(`DL17 ${flow} ${engine} ${report.build ?? rev}: ${report.pass === null ? 'NO READING' : verdict}${report.violations.length > 0 ? `\n  - ${report.violations.join('\n  - ')}` : ''}${(report.ringReattached ?? []).length > 0 ? `\n  ring re-attachments (Shardfile, a DL5 target, not in the verdict): ${report.ringReattached.length} (${report.ringReattached.slice(0, 3).join('; ')})` : ''}${(report.distanceLod ?? []).length > 0 ? `\n  distance LOD (resident models, the shard's design, not in the verdict): ${report.distanceLod.length} (first: ${report.distanceLod.slice(0, 4).join('; ')})` : ''}${(report.lapRoute?.skipped ?? []).length > 0 ? `\n  containment legs (the physics walk's, not driven in the lap): ${report.lapRoute.skipped.length} (${report.lapRoute.skipped.join(', ')})` : ''}${(report.neighbour ?? []).length > 0 ? `\n  neighbours (G828, not in the verdict):\n  ~ ${report.neighbour.join('\n  ~ ')}` : ''}${report.errors.length > 0 ? `\n  errors: ${report.errors.slice(0, 3).join(' | ')}` : ''}\n  report ${out}`);
process.exit(report.pass === null ? 2 : report.pass ? 0 : 1);
