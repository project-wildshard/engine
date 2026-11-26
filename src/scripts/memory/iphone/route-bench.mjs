#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): one command runs a zone's route bench cold and writes a table.
//
//   node src/scripts/memory/iphone/route-bench.mjs [--zone driftwood-isle] [--route <name>] [--runs 3] [--caps 30,60] [--base <origin>]
//     [--driver inspector|webkit] [--slots key=value ...] [--rec <segment> ...] [--legs <n>] [--ab <slot>|<slot>=<on>/<off>] [--profile <s>] [--profile-delay <s>] [--cool-to <°C> [--cool-outside]] [--census] [--voices] [--frames [--gpu-fence]] [--fenced-gpu <n>] [--leg-census] [--leg-alloc] [--leg-shots] [--leg-vsync] [--heap-at <leg> ...] [--page-eval <body> ...] [--page-read <body> ...] [--out <dir>] [--dry-run]
//
// --route plays another of route.mjs's routes in the zone (DF2's turning `driftwood-fps`); the default is the zone's own.
// --census reads, at the route's end, which owners draw the triangles in each pass (census.mjs), on the device itself.
// --voices times every procedural voice render from the wake lock to the route's end (census.mjs), with the page clock.
// --frames logs every frame over 45 ms from the wake lock to the route's end with the links, uploads and scene adds in it,
// and on the phone JavaScriptCore's collections (the inspector's Heap agent), then names each frame over 50 ms's cause. --gpu-fence adds WebGL2 fences and a full-collection
// sentinel (gpuFence.mjs): whether each long frame waited on the GPU or ran a full collection.
// --fenced-gpu <n> fences one frame in n with readPixels on each leg (fps/gpuProbe.mjs, DF5): the GPU time the 30 fps cap hides.
// --leg-vsync reads each leg's drawn frames by their vsync timestamps (the cadence shown) and how late each callback ran.
// --heap-at <leg> (DF18, inspector driver) sums JavaScriptCore's live heap by class after that leg: what a full collection marks.
// --leg-shots saves the world canvas at each leg's end (shot-<n>-<leg>.jpg in the run's folder): a look board off the route.
// --leg-alloc counts, on every leg, the new typed-array storage and its largest call sites (JSC's full-collection pressure).
// --leg-census reads, on every leg, which owners draw the triangles of the leg's heaviest tenth of sampled frames (DW3).
// --page-eval <body> (DF20, mini-df20) runs a page-function body once the zone has control, before the route (a compositor
// trial: `document.getElementById('hud').style.display='none'` hides the HUD); repeatable, each result is logged.
// --page-read <body> runs a page-function body after the route (what a --page-eval probe gathered); its result goes in route.json.
// --slots graphics=high runs phone High. --rec presses the game's REC 30 S over the named segments (DW2's frame split). --legs n plays the first n segments only.
//
// Each run plays the route (route.mjs) once per cap, each from its own cold boot (fresh Safari on the phone, a fresh WebKit
// on the Mac; origin storage cleared, phone Low seeded), so every pass starts at the dock; the cap order alternates run to run. The phone runs under
// iphone13.lock (locks.mjs), with no WebDriver session: devicectl opens Safari and Web Inspector drives it
// (inspector.mjs). `--driver webkit` is the desktop proxy (headless WebKit as an iPhone 13) under desktop-gpu.lock.
// Output: <out>/route.json (every leg's samples) and <out>/route.md (one row per run, cap and segment, then the worst).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { deviceSavePicks } from '../../debug-settings.mjs';
import { enterZone, phoneSlots } from './safari.mjs';
import { fenceFrames, fenceWaits, GPU_FENCE_READ, GPU_FENCE_START } from './gpuFence.mjs';
import { observeFencedGpu } from '../../fps/gpuProbe.mjs';
import { FRAME_LOG_READ, FRAME_LOG_START, gapWork, LEG_ALLOC_START, LEG_ALLOC_STOP, LEG_VSYNC_START, LEG_VSYNC_STOP, LEG_CENSUS_START, LEG_CENSUS_STOP, nameLongFrames, otherKind, OWNER_CENSUS, VOICE_LOG_READ, VOICE_LOG_START, VOICE_WORKER_READ } from './census.mjs';
import { askWake, holdWake, unlockAudio, playRoute, routeFor, routeTable, worstSegment } from './route.mjs';
import { lockKind, underLock } from './locks.mjs';

const { values } = parseArgs({ options: {
  zone: { type: 'string', default: 'driftwood-isle' }, route: { type: 'string' }, runs: { type: 'string', default: '3' }, caps: { type: 'string', default: '30,60' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, driver: { type: 'string', default: 'inspector' },
  slots: { type: 'string', multiple: true }, 'lock-log': { type: 'string', default: 'tmp/iphone13/lockstate.log' }, rec: { type: 'string', multiple: true }, 'heap-at': { type: 'string', multiple: true }, legs: { type: 'string' }, ab: { type: 'string' }, profile: { type: 'string' }, 'profile-delay': { type: 'string' }, 'cool-to': { type: 'string' }, 'cool-outside': { type: 'boolean' }, cooled: { type: 'boolean' }, out: { type: 'string' }, udid: { type: 'string' },
  'dry-run': { type: 'boolean' }, census: { type: 'boolean' }, voices: { type: 'boolean' }, 'cache-off': { type: 'boolean' }, frames: { type: 'boolean' }, 'gpu-fence': { type: 'boolean' }, 'fenced-gpu': { type: 'string' }, 'leg-census': { type: 'boolean' }, 'leg-alloc': { type: 'boolean' }, 'leg-shots': { type: 'boolean' }, 'leg-vsync': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
  'page-eval': { type: 'string', multiple: true }, 'page-read': { type: 'string', multiple: true },
} });
const runs = Number(values.runs), caps = /** @type {(30|60)[]} */ (values.caps.split(',').map(Number));
if (!Number.isSafeInteger(runs) || runs < 1 || caps.length === 0 || caps.some((cap) => cap !== 30 && cap !== 60)) throw new Error('--runs is a positive integer, --caps a list of 30 and 60');
if (!['inspector', 'webkit'].includes(values.driver)) throw new Error('--driver is inspector (the iPhone) or webkit (the desktop proxy)');
const route = values.route ?? values.zone;
routeFor(route);
const base = new URL(values.base).href;
const slots = Object.fromEntries(Object.entries(deviceSavePicks(values.slots ?? [])).map(([key, text]) => {
  try { return [key, JSON.parse(text)]; } catch { return [key, text]; }
}));
const out = resolve(values.out ?? join('tmp/iphone13', `route-${values.zone}-${String(Date.now())}`));
/** The raster witness, read once the zone has control: what the phone really renders at (a page-function body). */
const RASTER_WITNESS = `
const g = window.__wildshard?.world?.game, r = g?.renderer;
if (r === undefined) return 'no game';
const gl = r.getContext();
let batches = 0;
g.scene?.traverse?.(o => { if (o.isBatchedMesh) batches++; });
return { dpr: r.getPixelRatio(), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], css: [innerWidth, innerHeight],
  phoneGraphics: g.phoneGraphics ?? null, multiDraw: gl.getExtension('WEBGL_multi_draw') !== null, batches,
  saved: (() => { try { const keys = JSON.parse(localStorage.getItem('wildshard.save.v2@2.device') ?? '{}').keys ?? {};
    return { graphics: keys.graphics?.data ?? null, deviceKeys: Object.keys(keys), devMode: keys.devMode?.data ?? null, storage: Object.keys(localStorage), restored: window.__wsLowGuard ?? 0 }; } catch (e) { return String(e); } })() };
`;

/** mini-phone-pairs (2026-11-21): the phone's seeded saves (Low, developer mode, the trial's slots) vanish from Safari's
 * localStorage after the zone page loads (codex-tc48's DF5 finding; at control the device document keeps the game's own
 * keys but not the seeds), and the 2 s mode re-read then renders High. A page bootstrap holds the seeds the way a player's
 * saved choice would: every read or write of the device or global document gets any missing seed back, and
 * `__wsLowGuard` counts how often a seed had to be restored. @param {unknown[]} fixtures */
const lowGuard = (fixtures) => `(() => {
  const fixtures = ${JSON.stringify(fixtures)}, proto = Storage.prototype, get = proto.getItem, set = proto.setItem;
  const docs = { 'wildshard.save.v2@2.device': 'device', 'wildshard.save.v2@2.global': 'global' };
  const seen = new Map();
  const hold = (name, raw) => {
    const scope = docs[name];
    if (scope === undefined) return raw;
    // the game re-reads these documents often (the 2 s mode check): an unchanged string returns its last answer, no parse
    const last = seen.get(name);
    if (last !== undefined && last[0] === raw) return last[1];
    const out = fill(scope, raw);
    seen.set(name, [raw, out]);
    return out;
  };
  const fill = (scope, raw) => {
    let doc; try { doc = JSON.parse(raw ?? '{"keys":{}}'); } catch { return raw; }
    if (typeof doc !== 'object' || doc === null) return raw;
    doc.keys ??= {};
    let changed = false;
    for (const f of fixtures) {
      if (f.scope !== scope) continue;
      const now = doc.keys[f.key]?.data;
      if (f.merge) {
        const base = typeof now === 'object' && now !== null ? now : {};
        if (Object.entries(f.data).some(([k, v]) => base[k] !== v)) { doc.keys[f.key] = { v: 1, data: { ...base, ...f.data } }; changed = true; }
      } else if (doc.keys[f.key] === undefined) { doc.keys[f.key] = { v: 1, data: f.data }; changed = true; }
    }
    if (!changed) return raw;
    window.__wsLowGuard = (window.__wsLowGuard ?? 0) + 1;
    return JSON.stringify(doc);
  };
  proto.getItem = function (name) { const raw = get.call(this, name); return this === localStorage ? hold(name, raw) : raw; };
  proto.setItem = function (name, value) { return set.call(this, name, this === localStorage ? hold(name, value) : value); };
})();`;

/** DF9 (mini-df9b): the far copies' report at the route's end (a page-function body), or null with the slot off. */
const FAR_LOD_READ = `
const r = window.__wsFarLod;
if (r === undefined) return null;
// DF9/DF10 (mini-dfload): the loading step's far-copy settle (its ms, what it left for play, the build ms by then) and the
// batches whose programs it linked
return { meshes: r.meshes, tiled: r.tiled, squares: r.squares, ready: r.ready, reused: r.reused, writes: r.writes, full: r.full, drawn: r.drawn,
  captureMs: Math.round(r.captureMs), buildMs: Math.round(r.buildMs), loadingBuildMs: Math.round(r.loadingBuildMs ?? -1), settleMs: r.settleMs ?? null,
  settleLeft: r.settleLeft ?? null, settleCaptured: r.settleCaptured ?? null, buildAtSettle: r.buildAtSettle ?? null,
  batchPrograms: window.__wsBatchPrograms ?? null, refused: r.refused, whole: r.whole, log: r.log };
`;

async function bench() {
  mkdirSync(out, { recursive: true });
  /** @type {any[]} */
  const report = [];
  const phone = values.driver === 'inspector';
  const tools = phone ? await phoneTools() : null;
  const environment = { zone: values.zone, base, driver: values.driver, runs, caps, slots, startedAt: new Date().toISOString(),
    routeName: route, route: routeFor(route), phone: tools?.facts ?? null, idleCelsius: tools?.idle ?? null };
  writeFileSync(join(out, 'environment.json'), JSON.stringify(environment, null, 2));
  try {
    // --ab <slot>[,<slot>]: each run plays the slots off and on, in alternating order (ABBA), so the pairs share one idle reading
    const sides = values.ab === undefined ? [null] : [false, true];
    const trials = Array.from({ length: runs }, (_, i) => (i % 2 === 0 ? sides : [...sides].reverse())
      .flatMap((ab) => (i % 2 === 0 ? caps : [...caps].reverse()).map((cap) => ({ run: i + 1, cap, ab })))).flat();
    for (const { run, cap, ab } of trials) {
      // DF10 (mini-dfload): `--ab a,b` turns several slots off and on together (farBatch and kitBatch are one trial)
      // DW3 (mini-dw3): `--ab key=on/off` trials a valued slot (`debug.coverReachLow=0.8/1`); a bare key is a boolean
      const abValue = (/** @type {string} */ item) => { const at = item.indexOf('='); if (at === -1) return [item, ab];
        const [on, off] = item.slice(at + 1).split('/'); if (off === undefined) throw new Error(`--ab ${item}: write key=on/off`);
        return [item.slice(0, at), JSON.parse(ab ? on : off)]; };
      const trialSlots = ab === null || values.ab === undefined ? slots : { ...slots, ...Object.fromEntries(values.ab.split(',').map(abValue)) };
      const temperature = tools === null ? null : await tools.cool();
      const opened = phone ? { webkitDriver: null, driver: await /** @type {NonNullable<typeof tools>} */ (tools).fresh() }
        : await (async () => { if (values.frames === true) process.env.WS_WEBKIT_GC_LOG = '1'; const { startWebKit } = await import('./webkit.mjs'); const started = await startWebKit({ gcLog: values.frames === true }); return { webkitDriver: started, driver: started }; })();
      const { webkitDriver } = opened;
      let { driver } = opened;
      const directory = join(out, `run-${String(run)}-cap${String(cap)}${ab === null ? '' : `-${String(ab)}`}`);
      mkdirSync(directory, { recursive: true });
      /** @type {Promise<void> | null} */
      let profiling = null;
      /** @type {any} */
      const row = { run, cap, ab, temperature, boot: null, legs: [], error: null, screenshot: null };
      try {
        tools?.lockState(`run ${String(run)} cap ${String(cap)} before boot`);
        // --cache-off (DF8): Safari's resource cache off for the boot, a first load of a new build (link-bench's cold runs)
        // mini-phone-pairs: hold the seeds through the page's storage loss (lowGuard); High runs are left alone
        const bootOn = async (/** @type {any} */ page) => {
          if (phone && trialSlots.graphics !== 'high' && typeof Reflect.get(page, 'bootstrap') === 'function') await page.bootstrap(lowGuard(phoneSlots(trialSlots)));
          return enterZone(page, { base, slug: values.zone, slots: trialSlots, cacheOff: values['cache-off'] === true });
        };
        // DW3 (mini-dw3, 2026-11-23): the first pages attached after the inspector proxy starts can leave an evaluate
        // unanswered (five jobs in a row: run 1's first arm failed, a later fresh Safari answered at once; one replay's
        // second page then left its storage reset unsettled), and the runner then voids the job and plays it all again.
        // Up to two more fresh Safaris, in the same run, before the boot counts as failed.
        let boot;
        for (let tries = 0; ; tries++) {
          try { boot = await bootOn(driver); break; } catch (error) {
            if (!phone || tries >= 2 || !/Runtime\.evaluate timed out|did not settle an async script/.test(String(error))) throw error;
            console.log(`run ${String(run)}: the page did not answer (${String(error).slice(0, 80)}); one more fresh Safari`);
            try { await /** @type {any} */ (driver).close?.(); } catch { /* the stuck page */ }
            await pause(10_000);
            driver = await /** @type {NonNullable<typeof tools>} */ (tools).fresh();
          }
        }
        row.boot = { outcome: boot.outcome, controlS: boot.controlAt !== null && boot.startedAt !== null ? (boot.controlAt - boot.startedAt) / 1000 : null,
          build: boot.state?.build ?? null, version: boot.state?.version ?? null, error: boot.state?.error ?? null };
        tools?.lockState(`run ${String(run)} cap ${String(cap)} after boot`);
        console.log(`run ${String(run)} cap ${String(cap)}${ab === null ? '' : ` ${String(values.ab)}=${String(ab)}`}: ${boot.outcome} in ${String(row.boot.controlS)} s (${String(row.boot.version)})`);
        if (boot.outcome === 'control') {
          // DF10 (mini-df10d): the raster witness (codex-tc48 found the Low seeding could come up at High): the drawing
          // buffer's DPR and size, the tier, the multi-draw extension and the slots the page actually read
          row.raster = await driver.evaluate(RASTER_WITNESS).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          console.log(`  raster: ${JSON.stringify(row.raster)}`);
          // mini-phone-pairs (2026-11-21): a phone boot seeded Low that renders above DPR 1 lost its Low save (codex-tc48's
          // DF5 finding); refuse it before the route plays, so a pair never compares a High arm and the hold ends early
          if (phone && trialSlots.graphics !== 'high' && row.raster?.dpr !== 1) throw new Error(`NOT AT LOW: raster ${JSON.stringify(row.raster)}`);
          // --page-eval (DF20): the trial's page changes, after the witness and before the route
          row.pageEval = [];
          for (const body of values['page-eval'] ?? []) {
            const result = await driver.evaluate(body).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
            row.pageEval.push(result);
            console.log(`  page eval: ${JSON.stringify(result)?.slice(0, 400)}`);
          }
          if ('gesture' in driver && typeof driver.gesture === 'function') await driver.gesture(askWake).catch(() => undefined);
          row.wakeLock = await driver.evaluateAsync(holdWake, [], 10_000).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          console.log(`  wake lock: ${String(row.wakeLock)}`);
          // --gpu-fence (DF8, mini-driftwood13n): WebGL2 fences and a full-collection sentinel beside the frame log (gpuFence.mjs)
          if (values['gpu-fence'] === true) row.fenceLog = await driver.evaluate(GPU_FENCE_START).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (values.frames === true) row.frameLog = await driver.evaluate(FRAME_LOG_START).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (values.frames === true && 'heapStart' in driver && typeof driver.heapStart === 'function') row.heapLog = await driver.heapStart().then(() => 'logging', (/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (values.voices === true) row.voiceLog = await driver.evaluate(VOICE_LOG_START).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if ('gesture' in driver && typeof driver.gesture === 'function') row.audioUnlock = await driver.gesture(unlockAudio).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          // --profile <s>: WebKit's sampling profiler over the route's first seconds (DW2: what the long tasks are)
          if (values.profile !== undefined && 'profileStart' in driver && typeof driver.profileStart === 'function') {
            const profiled = driver;
            // --profile-delay <s>: start the sampler that long after the route starts, to reach a later leg (a long
            // sample overflows the inspector socket: 8 s with the top-up off closed it three times, 3 s did not)
            const delay = Number(values['profile-delay'] ?? 0) * 1000;
            if (delay === 0) await profiled.profileStart();
            profiling = (async () => {
              try {
                if (delay > 0) { await pause(delay); await profiled.profileStart(); }
                await pause(Number(values.profile) * 1000);
                const samples = await profiled.profileStop();
                writeFileSync(join(directory, 'profile.json'), JSON.stringify(samples));
                console.log(`  profile: ${String(samples.length)} samples in ${join(directory, 'profile.json')}`);
              } catch (error) { console.log(`  profile: ${String(error)}`); }
            })();
          }
          if ('quiet' in driver && typeof driver.quiet === 'function') await driver.quiet();
          // --fenced-gpu <n> (DF5, mini-dwfps): fence one frame in n per leg (fps/gpuProbe.mjs), a GPU time the cap cannot clamp
          const every = values['fenced-gpu'] === undefined ? 0 : Number(values['fenced-gpu']);
          // --leg-census (DW3, mini-dw3): the owners of each leg's heaviest sampled frames (census.mjs LEG_CENSUS_*), beside the fence
          const legCensus = values['leg-census'] === true;
          // --leg-alloc (DW3): each leg's new typed-array storage and its largest call sites (census.mjs LEG_ALLOC_*)
          // --leg-shots (DW3): the world canvas at each leg's end, a JPEG per leg in the run's folder (a look board from the route)
          const legShots = values['leg-shots'] === true;
          // --leg-vsync (DW3): each leg's drawn-frame cadence by vsync timestamp, beside the game clock's (census.mjs LEG_VSYNC_*)
          const legVsync = values['leg-vsync'] === true;
          const legAlloc = values['leg-alloc'] === true, many = legCensus || legAlloc || legShots || legVsync;
          const probe = every > 0 || many ? {
            start: `const out = {}; ${every > 0 ? `window.__wsFenced = (${observeFencedGpu.toString()})(window.__wildshard.world.game, ${String(every)}); out.fenced = 'fencing';` : ''}
              ${legCensus ? `out.census = (() => { ${LEG_CENSUS_START} })();` : ''} ${legAlloc ? `out.alloc = (() => { ${LEG_ALLOC_START} })();` : ''} ${legVsync ? `out.vsync = (() => { ${LEG_VSYNC_START} })();` : ''} return out;`,
            stop: `const out = {}; ${every > 0 ? 'const stop = window.__wsFenced; window.__wsFenced = undefined; out.fenced = stop === undefined ? null : stop();' : ''}
              ${legCensus ? `out.census = (() => { ${LEG_CENSUS_STOP} })();` : ''} ${legAlloc ? `out.alloc = (() => { ${LEG_ALLOC_STOP} })();` : ''} ${legVsync ? `out.vsync = (() => { ${LEG_VSYNC_STOP} })();` : ''}
              ${legShots ? `return window.__wildshard.world.game.captureFrame(390).then((c) => new Promise((done) => { c.toBlob(done, 'image/jpeg', 0.9); })).then((b) => b.arrayBuffer()).then((bytes) => { out.shot = Array.from(new Uint8Array(bytes)); return out; });` : `return ${many ? 'out' : 'out.fenced'};`}` } : undefined;
          row.legs = await playRoute(driver, { slug: route, cap, rec: values.rec ?? [], legs: values.legs === undefined ? undefined : Number(values.legs), probe, heapAt: values['heap-at'] ?? [], log: (line) => { console.log(`  ${String(cap)} ${line}`); } });
          // --page-read (DF20): what the trial's page probes gathered over the route
          row.pageRead = [];
          for (const body of values['page-read'] ?? []) {
            const result = await driver.evaluate(body).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
            row.pageRead.push(result);
            console.log(`  page read: ${JSON.stringify(result)}`);
          }
          if (every > 0) for (const leg of row.legs) console.log(`  fenced ${leg.name}: ${JSON.stringify(many ? leg.probe?.fenced : leg.probe)}`);
          if (legShots) for (const [i, leg] of row.legs.entries()) {
            const shot = leg.probe?.shot; if (!Array.isArray(shot) || shot.length === 0) { console.log(`  leg shot ${leg.name}: none`); continue; }
            const file = join(directory, `shot-${String(i + 1).padStart(2, '0')}-${leg.name.replaceAll(/[^a-z0-9]+/giu, '-').toLowerCase()}.jpg`);
            writeFileSync(file, Uint8Array.from(shot)); delete leg.probe.shot;
            console.log(`  leg shot ${leg.name}: ${file}`);
          }
          // DF18 (mini-dw3): --heap-at <leg> sums JavaScriptCore's live heap by class after that leg (what a full collection marks)
          for (const leg of row.legs) if (leg.heap !== undefined) console.log(`  heap after ${leg.name}: ${JSON.stringify(leg.heap).slice(0, 2400)}`);
          if (legVsync) for (const leg of row.legs) console.log(`  leg vsync ${leg.name}: ${JSON.stringify({ ...leg.probe?.vsync, at: undefined, ends: undefined })} (game clock p95 ${String(leg.summary?.p95Ms ?? '?')})`);
          if (legAlloc) for (const leg of row.legs) {
            const a = leg.probe?.alloc;
            console.log(`  leg alloc ${leg.name}: ${String(a?.mb ?? '?')} MB in ${String(a?.count ?? '?')} buffers over ${String(a?.seconds ?? '?')} s (${String(a?.mbPerSecond ?? '?')} MB/s) ${JSON.stringify(a?.byKind ?? {})}`);
            for (const [site, n, mb] of a?.sites?.slice(0, 10) ?? []) console.log(`    ${String(mb).padStart(7)} MB ${String(n).padStart(5)}  ${String(site).slice(0, 220)}`);
          }
          if (legCensus) for (const leg of row.legs) {
            const c = leg.probe?.census;
            console.log(`  leg census ${leg.name}: ${String(c?.sampled ?? 0)} frames, heaviest tenth ${String(c?.heavyTriangles ?? '?')} tris, mean ${String(c?.meanTriangles ?? '?')}`);
            for (const [owner, draws, triangles] of c?.heavy?.slice(0, 12) ?? []) console.log(`    ${String(triangles).padStart(8)} ${String(draws).padStart(5)}  ${String(owner)}`);
          }
          // DF9 (mini-df9b): what the far copies did on the route (farLod.ts `__wsFarLod`), when the slot is on
          row.farLod = await driver.evaluate(FAR_LOD_READ).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (row.farLod !== null) console.log(`  farLod: ${JSON.stringify(row.farLod).slice(0, 1500)}`);
          if (values.voices === true) {
            try {
              const log = /** @type {[string, number, number, number, number][] | null} */ (await driver.evaluate(VOICE_LOG_READ));
              row.voices = log;
              const byFamily = new Map();
              for (const render of log ?? []) { const family = render[0], ms = render[4], f = byFamily.get(family) ?? [0, 0, 0]; f[0]++; f[1] += ms; f[2] = Math.max(f[2], ms); byFamily.set(family, f); }
              for (const [family, [count, ms, worst]] of [...byFamily].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12)) console.log(`  voices ${family}: ${String(count)} renders, ${ms.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
              row.voiceWorker = await driver.evaluate(VOICE_WORKER_READ).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
              console.log(`  voice worker: ${JSON.stringify(row.voiceWorker)}; page-thread renders over 30 ms: ${String((log ?? []).filter((render) => render[4] > 30).length)}`);
            } catch (error) { row.voicesError = String(error); }
          }
          if (values.frames === true) {
            try {
              const log = await driver.evaluate(FRAME_LOG_READ);
              row.frames = log;
              const long = (log?.frames ?? []).filter((/** @type {any[]} */ f) => f[1] > 50);
              console.log(`  frames: ${String(log?.count ?? 0)} logged, ${String(long.length)} over 50 ms, ${String(long.filter((/** @type {any[]} */ f) => f[2] > 0 || f[4] > 65536 || f[5] > 65536).length)} of them with links or big uploads, ${String(log?.adds?.length ?? 0)} scene adds`);
              // DF8: each long update with the game's own split (FRAME_LOG_START's costs)
              // mini-driftwood13m: from 25 ms, so the one-off stalls name their part
              for (const c of (log?.costs ?? []).filter((/** @type {any[]} */ cost) => cost[1] > 25)) {
                console.log(`  update ${String(c[1])} ms at ${String(Math.round((c[0] - (log?.from ?? 0)) / 100) / 10)} s: top ${String(c[3])}; ${String(c[4])}`);
              }
              // DF8 (mini-driftwood13h): each frame over 50 ms named (gc, compile, upload, update, render, other)
              if (row.heapLog === 'logging' && 'heapStop' in driver && typeof driver.heapStop === 'function') {
                row.gc = await driver.heapStop().catch((/** @type {unknown} */ error) => ({ error: String(error), collections: [] }));
                const gcs = /** @type {[string, number, number][]} */ (row.gc?.collections ?? []);
                console.log(`  gc: ${String(gcs.length)} collections (${String(gcs.filter((c) => c[0] === 'full').length)} full), ${String(gcs.filter((c) => c[2] - c[1] >= 10).length)} of 10 ms or more, anchor ±${String((row.gc?.anchorMs ?? 0) / 2)} ms`);
                // DF9 (mini-df9b): the desktop proxy's JSC log also has each collection's stop-the-world pause
                const pauses = /** @type {number[] | undefined} */ (row.gc?.pauses);
                if (pauses !== undefined) console.log(`  gc pauses: ${String(pauses.filter((ms) => ms >= 10).length)} of 10 ms or more, ${String(pauses.filter((ms) => ms >= 5).length)} of 5, total ${pauses.reduce((a, b) => a + b, 0).toFixed(0)} ms`);
              }
              const named = nameLongFrames(log?.frames ?? [], row.gc?.collections ?? []);
              row.named = named;
              /** @type {Record<string, number>} */
              const byCause = {};
              // mini-driftwood13m: with `debug.taskStamp` on, an `other` frame says whether a callback, unwrapped work or nothing held the main thread
              for (const n of named) { const kind = n.cause === 'other' ? otherKind(n, log ?? {}) : null; if (kind !== null) { n.causes.push(kind); n.cause = `other ${kind.startsWith('task ') ? 'task' : kind}`; } byCause[n.cause] = (byCause[n.cause] ?? 0) + 1; }
              console.log(`  long frames by cause: ${JSON.stringify(byCause)}`);
              const gaps = gapWork(named, log ?? {});
              row.gaps = gaps;
              /** @type {ReturnType<typeof fenceFrames>} */
              let fenced = [];
              if (values['gpu-fence'] === true) {
                const fl = await driver.evaluate(GPU_FENCE_READ).catch(() => null);
                row.fences = fl; fenced = fenceFrames(named, fl);
                console.log(`  gpu fence: ${String(row.fenceLog)}; frames waited ${JSON.stringify(fenceWaits(fl))}; full collections ${String(fl?.full?.length ?? 0)} (${String(fl?.arms ?? 0)} sentinels armed)`);
              }
              named.forEach((n, i) => { const gap = gaps[i] ?? [], f = fenced[i];
                const fence = f === undefined ? '' : ` | fence ${f.fences.map(([ms, waited, call]) => `${String(ms)}ms/${String(waited)}f/${String(call)}`).join(',') || 'none'}${f.gpu ? ' GPU' : ''}${f.full > 0 ? ` FULL-GC ${String(f.full)}` : ''}`;
                console.log(`  long ${String(Math.round(n.ms))} ms at ${String(Math.round((n.at - (log?.from ?? 0)) / 100) / 10)} s: ${n.causes.join('; ') || 'other'}${gap.length === 0 ? '' : ` | ${gap.join(' | ')}`}${fence}`); });
              // mini-driftwood13i: the systems that ran over 15 ms at least once: runs, total ms, runs over 5 / 15 ms, longest
              for (const [id, n, sum, over5, over15, max] of log?.sys ?? []) console.log(`  system ${String(id)}: ${String(n)} runs, ${String(sum)} ms, >5 ${String(over5)}, >15 ${String(over15)}, max ${String(max)}`);

            } catch (error) { row.framesError = String(error); }
          }
          if (values.census === true) {
            try {
              row.census = await /** @type {any} */ (driver).evaluateAsync(OWNER_CENSUS, [10], 30_000);
              console.log(`  census quality: ${JSON.stringify(row.census?.quality ?? null)}`);
              console.log(`  census vertex pack: ${JSON.stringify(row.census?.pack ?? null)}`);
              for (const [owner, draws, triangles] of row.census?.owners?.slice(0, 12) ?? []) console.log(`  census ${String(triangles).padStart(8)} ${String(draws).padStart(5)}  ${String(owner)}`);
            } catch (error) { row.censusError = String(error); console.log(`  census: ${row.censusError}`); }
          }
        }
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); console.log(`run ${String(run)}: ${row.error}`); }
      await profiling;
      if (String(row.error).startsWith('PHONE LOCKED')) { report.push(row); writeFileSync(join(out, 'route.json'), JSON.stringify(report, null, 2)); throw new Error(row.error); }
      try {
        const shot = join(directory, phone ? 'end.png' : 'end.jpg');
        await (phone ? /** @type {NonNullable<typeof tools>} */ (tools).screenshot(shot) : /** @type {any} */ (driver).screenshot(shot));
        row.screenshot = shot;
      } catch (error) { row.screenshotError = String(error); }
      await (webkitDriver === null ? /** @type {any} */ (driver).close?.().catch(() => undefined) : webkitDriver.stop());
      report.push(row);
      writeFileSync(join(out, 'route.json'), JSON.stringify(report, null, 2));
    }
  } finally { await tools?.stop(); }
  const lines = [`# ${values.zone} route bench`, '', `${values.driver} · ${base} · ${String(runs)} runs · caps ${caps.join(', ')} · ${environment.startedAt}`, ''];
  for (const row of report) {
    lines.push(`## Run ${String(row.run)}, cap ${String(row.cap)}${row.ab === null ? '' : `, ${String(values.ab)} ${String(row.ab)}`}: ${String(row.boot?.outcome ?? row.error)}${row.boot?.controlS ? `, control ${row.boot.controlS.toFixed(1)} s` : ''}${row.temperature === null ? '' : `, ${String(row.temperature)} °C`}`, '');
    lines.push(routeTable(row.legs), '');
    for (const leg of row.legs) if (typeof leg.rec === 'string') lines.push(`### REC 30 S: ${String(leg.name)}`, '', '```text', leg.rec, '```', '');
  }
  for (const cap of caps) {
    const ranked = worstSegment(report, cap);
    lines.push(`## Worst segments at cap ${String(cap)} (median over runs)`, '', '| Segment | p95 ms | >50 ms per 30 s | fps | runs |', '|---|---|---|---|---|',
      ...ranked.slice(0, 5).map((row) => `| ${row.name} | ${String(row.p95Ms)} | ${String(row.over50Per30s)} | ${String(row.fps)} | ${String(row.runs)} |`), '');
  }
  writeFileSync(join(out, 'route.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`route bench: ${join(out, 'route.md')}`);
}

/** The phone's side: doctor, idle temperature, a fresh Safari per run through devicectl, screenshots through devicectl. */
async function phoneTools() {
  const { batteryTemperature, command, doctor } = await import('./doctor.mjs');
  const { startInspector } = await import('./inspector.mjs');
  const { takeScreenshot } = await import('./record.mjs');
  const facts = doctor({ udid: values.udid, sharedPort: '4444' });
  const reading = () => batteryTemperature(command('idevicediagnostics', ['-u', facts.udid, 'ioregentry', 'AppleSmartBattery']).output)?.celsius ?? null;
  const launchUrl = new URL('/robots.txt', base).href;
  // the coordinator, 2026-11-19: the phone locked at 16:01-16:08 with Auto-Lock off and no lock command from us; every
  // proxy start and stop and every devicectl launch logs lockState before and after, and a locked phone stops the bench
  const lockLog = resolve(values['lock-log']);
  mkdirSync(dirname(lockLog), { recursive: true });
  const lockState = (/** @type {string} */ label) => {
    const done = command('xcrun', ['devicectl', 'device', 'info', 'lockState', '--device', facts.udid]);
    const passcode = /passcodeRequired:\s*(\w+)/u.exec(done.output)?.[1] ?? 'unread';
    const since = /unlockedSinceBoot:\s*(\w+)/u.exec(done.output)?.[1] ?? '?';
    appendFileSync(lockLog, `${new Date().toISOString()} ${label} passcodeRequired=${passcode} unlockedSinceBoot=${since}\n`);
    if (passcode === 'true') throw new Error(`PHONE LOCKED at ${label} (lockState in ${lockLog}): stop touching the phone`);
  };
  lockState('before proxy start');
  const inspector = await startInspector(facts.udid, { launchUrl });
  lockState('after proxy start');
  const idle = reading();
  return {
    facts: { ...facts, udid: undefined }, idle,
    async fresh() {
      lockState('before devicectl launch');
      const driver = await inspector.fresh();
      lockState('after devicectl launch');
      return driver;
    },
    lockState,
    /** Wait (at most 10 min) for the battery to come back within 3 °C of the first reading, or to --cool-to °C. */
    async cool() {
      const deadline = Date.now() + 10 * 60_000;
      let now = reading();
      const line = values['cool-to'] === undefined ? (idle === null ? null : idle + 3) : Number(values['cool-to']);
      // --cool-outside: the outer process cooled the phone before taking the locks; inside them, only read (DF10 mini-df10c)
      if (line === null || values.cooled === true) return now;
      while (now !== null && now > line && Date.now() < deadline) {
        console.log(`cooling: ${String(now)} °C against ${String(line)} °C`);
        await pause(15_000);
        now = reading();
      }
      return now;
    },
    screenshot: (/** @type {string} */ file) => takeScreenshot(facts.udid, file),
    async stop() {
      // mini-driftwood13m: the last boot's game page kept running (and its wake lock held), so the phone never cooled
      // between benches (39.7 °C for 10 min under the lock); park Safari on about:blank before the locks go
      lockState('before park');
      const parked = command('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', facts.udid,
        '--terminate-existing', '--payload-url', 'about:blank', 'com.apple.mobilesafari']);
      if (!parked.ok) throw new Error(`Safari blank parking failed: ${parked.output}`);
      lockState('before proxy stop');
      await inspector.stop();
      lockState('after proxy stop');
    },
  };
}

if (values['dry-run']) {
  console.log(JSON.stringify({ zone: values.zone, runs, caps, base, driver: values.driver, slots, out, route, legs: routeFor(route).map((leg) => `${leg.name} (${leg.kind} ${String(leg.seconds)} s)`) }, null, 2));
} else if (!values['with-locks']) {
  // MINI-DEVEX MD2: the phone holds iphone13.lock only; the desktop proxy measures on the Mac under desktop-gpu.lock (locks.mjs)
  const kind = lockKind(values.driver);
  // MD1: a phone run is a job for the phone runner, which cools the phone outside the lock (DF10, the coordinator
  // 2026-11-20: never inside it) to --cool-to (36 °C by default) and then runs this bench with --cooled, so it never cools
  // while holding the phone. --cool-outside is what every phone run now does.
  process.exitCode = kind === 'phone'
    ? await underLock(kind, import.meta.filename, [...process.argv.slice(2), '--out', out, '--with-locks'], { coolTo: Number(values['cool-to'] ?? 36), cooledFlag: '--cooled' })
    : await underLock(kind, import.meta.filename, [...process.argv.slice(2), '--out', out, '--with-locks']);
} else {
  await bench();
}
