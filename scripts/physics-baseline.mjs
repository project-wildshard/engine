#!/usr/bin/env node
// physics-baseline.mjs — the PHYSICS.md ruler: P0 records it before a line of Rapier, every later phase re-runs it.
//
// Fixed walk routes run in the checked-product Node harness. Pose, grid and the optional --trails diagnostic use
// the production browser bundle, headless Chromium on the host GPU (Metal via ANGLE), phone tier (390×844).
//
//   poses — the seven PLAY-PERF poses at 4× CPU: per frame, the JS ms of every game updater together, of
//           `player.update` and `animals.update` alone, of the composer render, the rAF interval, and the
//           composer frame's draw calls / triangles. Reported as p50 / p95 over --frames frames.
//   walk  — the fixed route per shard (scripts/physics-route.json), ordered in one native resident per shard.
//           Actual player motion advances within 0.8 m; < 0.3 m progress in 2 s refuses the leg, without teleporting.
//           ESCAPE legs (`inside: { x0, x1, z0, z1, floor }`) try to get out of a built fragment: their waypoints lie past a
//           wall or a balustrade, a `jump: 2` waypoint jumps and double-jumps at it from `jumpAt` m off (default 1.6), and
//           `start.hover` rides the board. They are never teleported: a waypoint the walls stop is dropped after 1.2 s
//           with no progress (not a stuck). `out` = the frames spent outside `inside` (0 = the edge held).
//           `--trails` retains the ad hoc browser trail diagnostic and its optional --video capture.
//
// Writes progress/physics/<label>-<build>.json (everything) and prints a markdown table. `--compare a.json b.json`
// prints before / after for two result files.
//
//   node scripts/physics-baseline.mjs                         # build, poses + walk, label p0
//   node scripts/physics-baseline.mjs --no-build --mode=walk
//   node scripts/physics-baseline.mjs --label=p2 --mode=walk
//   node scripts/physics-baseline.mjs --no-build --mode=walk --trails --video
//   node scripts/physics-baseline.mjs --no-build --mode=walk --route=progress/shard-platform/sf46/entries-route.json  # a row's own legs
//   node scripts/physics-baseline.mjs --compare progress/physics/p0-x.json progress/physics/p2-y.json
//   node scripts/physics-baseline.mjs --mode=walk --trails --shard=nalati-grasslands --url=http://127.0.0.1:5188
//   scripts/browser-lane.sh node scripts/physics-baseline.mjs --mode=grid --url=http://127.0.0.1:5188
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { debugSettings, saveFixture } from './debug-settings.mjs';
import { walkPhysicsLeg } from './physics-walk.mjs';
import { runNativePhysicsWalk } from './physics-native.mjs';
import { driveGridSeam, gridSeamRoute, gridDriveFailures } from './physics-grid.mjs';
import { enterPhysicsGrid, physicsEntryInventory, physicsEntryPierReady, physicsEntryFailures, waitForPhysicsBoot } from './physics-grid-entry.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const ROOT = resolvePath(new URL('..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
const has = (name) => argv.includes(`--${name}`);
const OUT_DIR = resolvePath(ROOT, flag('out', 'progress/physics'));
const ENTRY = flag('entry', 'shard');
if (!['shard', 'grid', 'grid-only'].includes(ENTRY)) throw new Error('--entry must be shard, grid or grid-only');

const POSES = [
  { shard: 'pine-hollow', name: 'gate', q: 'x=0&z=-200&yaw=3.1416' },
  { shard: 'pine-hollow', name: 'cabin', q: 'x=-14&z=-62&yaw=3.1416' },
  { shard: 'pine-hollow', name: 'pond', q: 'x=-56&z=95&yaw=3.1416' },
  { shard: 'driftwood-isle', name: 'pier', q: '' },
  { shard: 'driftwood-isle', name: 'beach', q: 'x=-10&z=-150&yaw=4.3' },
  { shard: 'driftwood-isle', name: 'wreck', q: 'x=105&z=0&yaw=-1.5708' },
  { shard: 'driftwood-isle', name: 'shrine', q: 'x=-86&z=92&yaw=2.47' },
  // Nalati (NALATI-MERGE P4): the camp from the spur, the bridge from the N road, the horse plains' herd from the bowl
  { shard: 'nalati-grasslands', name: 'camp', q: 'x=60&z=214&yaw=-1.5708' },
  { shard: 'nalati-grasslands', name: 'bridge', q: 'x=0&z=200&yaw=0' },
  { shard: 'nalati-grasslands', name: 'plains', q: 'x=65&z=0&yaw=3.1416' },
];

// `--set=ph`: Pine Hollow's PH-P4 poses (the remaster's zones, the creatures + thralls + the life lane live) instead of the seven
const PH_POSES = [
  { shard: 'pine-hollow', name: 'gate', q: 'x=0&z=-200&yaw=3.1416' },
  { shard: 'pine-hollow', name: 'cabin', q: 'x=-14&z=-62&yaw=3.1416' },
  { shard: 'pine-hollow', name: 'pond', q: 'x=-56&z=95&yaw=3.1416' },
  { shard: 'pine-hollow', name: 'hamlet', q: 'x=-150&z=-104&yaw=0' },
  { shard: 'pine-hollow', name: 'clearing (King, night)', q: 'boss=antler-king&bossGod=1' },
  { shard: 'pine-hollow', name: 'old-growth night (thralls)', q: 'x=150&z=10&yaw=0&tod=night' },
  { shard: 'pine-hollow', name: 'cave', q: 'x=192&z=190&yaw=-2.45' },
];

// ── compare ──
if (has('compare')) {
  const [a, b] = argv.filter((x) => x.endsWith('.json')).map((p) => JSON.parse(readFileSync(p, 'utf8')));
  if (!a || !b) { console.error('--compare a.json b.json'); process.exit(2); }
  if(Array.isArray(a.testResults)||Array.isArray(b.testResults)){
    if(!Array.isArray(a.testResults)||!Array.isArray(b.testResults))throw new Error('Compare two Node route reports, or two browser reports');
    const before=a.testResults.flatMap(file=>file.assertionResults),after=b.testResults.flatMap(file=>file.assertionResults);
    console.log(`Node physics: ${a.numPassedTests} passed / ${a.numFailedTests} failed → ${b.numPassedTests} passed / ${b.numFailedTests} failed`);
    console.log('| native route | before status / ms | after status / ms |\n|---|---|---|');
    for(const leg of before){
      const next=after.find(row=>row.fullName===leg.fullName);
      console.log(`| ${leg.fullName} | ${leg.status} / ${leg.duration??'n/a'} | ${next===undefined?'not collected':`${next.status} / ${next.duration??'n/a'}`} |`);
    }
    process.exit(0);
  }
  console.log(`before ${a.label} ${a.build} → after ${b.label} ${b.build}\n`);
  console.log('| pose | update p50 ms | player p50 | animals p50 | render p50 | calls | tris M |\n|---|---|---|---|---|---|---|');
  for (const pa of a.poses ?? []) {
    const pb = (b.poses ?? []).find((p) => p.shard === pa.shard && p.name === pa.name);
    const c = (k, f = (v) => v) => `${f(pa[k])} → ${pb ? f(pb[k]) : 'n/a'}`;
    console.log(`| ${pa.shard} ${pa.name} | ${c('updateP50')} | ${c('playerP50')} | ${c('animalsP50')} | ${c('renderP50')} | ${c('calls')} | ${c('trisM')} |`);
  }
  console.log('\n| leg | end (x, y, z) | max y | stuck | time s |\n|---|---|---|---|---|');
  for (const la of a.walk ?? []) {
    const lb = (b.walk ?? []).find((l) => l.shard === la.shard && l.name === la.name);
    const e = (l) => l ? `${l.end.x}, ${l.end.y}, ${l.end.z}` : 'n/a';
    console.log(`| ${la.shard} ${la.name} | ${e(la)} → ${e(lb)} | ${la.maxY} → ${lb?.maxY ?? 'n/a'} | ${la.stuck.length} → ${lb?.stuck.length ?? 'n/a'} | ${la.seconds} → ${lb?.seconds ?? 'n/a'} |`);
  }
  process.exit(0);
}

const MODE = flag('mode', 'poses,walk').split(',');
if (MODE.some((mode) => !['poses', 'walk', 'grid'].includes(mode))) throw new Error('--mode must name poses, walk or grid');
const LABEL = flag('label', 'p0');
const CPU = Number(flag('cpu', '4'));
const WALK_CPU = Number(flag('walk-cpu', '1'));
const FRAMES = Number(flag('frames', '300'));
const PORT = Number(flag('port', '4176'));
const SETTLE_MS = Number(flag('settle', '4000'));
const TIMEOUT_MS = Number(flag('timeout', '240')) * 1000;
const ONLY = flag('shard', '');
// Keep the phone baseline by default; explicitly select the other asset/physics tier for cross-tier proofs.
const TIER = flag('tier', 'phone');
if (TIER !== 'phone' && TIER !== 'desktop') throw new Error('--tier must be phone or desktop');
// Focused before/after repro: keep the authored route and controller unchanged.
const ONLY_LEG = flag('leg', '');
const REPEAT = Number(flag('repeat', '1'));
if (!Number.isInteger(REPEAT) || REPEAT < 1 || REPEAT > 10) throw new Error('--repeat must be 1…10');
const VIDEO = has('video');
// --trails: instead of the fixed route, walk every path of the shard (its TRAILS after the entry roads) end to end,
// both ways, a waypoint every 3 m — the stricter 0.35 m / 40° controller must not get stuck on a path players use
const TRAILS = has('trails');
const SERVE = resolvePath(flag('serve', ROOT)); // the checkout whose dist/ is served (a clean export of an older commit, for a same-session before / after)
if (flag('set', '') === 'ph') POSES.splice(0, POSES.length, ...PH_POSES); // --set=ph: Pine Hollow's poses
// --url: walk / pose against a server that is already running (a served build: no build or preview started here)
const URL_BASE = flag('url', '');
// --query=<k=v&…>: appended to every page's URL (a dev param, e.g. `--query=tier=phone`)
const EXTRA_Q = flag('query', '');
// --settings=<k=v,…>: pause ▸ Settings ▸ Debug picks set before every load (scripts/debug-settings.mjs; e.g. weather=clear)
const SETTINGS = Object.fromEntries(flag('settings', '').split(',').filter(Boolean).map((kv) => kv.split('=')));
// Authored Debug rows are device saves, separate from core global Settings.
const DEVICE_SAVES = Object.fromEntries(argv.filter((arg) => arg.startsWith('--device-save=')).map((arg) => {
  const match = /^--device-save=([a-zA-Z][a-zA-Z0-9._-]*)=(.+)$/u.exec(arg);
  if (!match) throw new Error('Invalid device save; expected key=value');
  return [match[1], match[2] === 'true' ? true : match[2] === 'false' ? false : match[2]];
}));
const EXPECTED_SYSTEMS = argv.filter((arg) => arg.startsWith('--expect-system=')).map((arg) => {
  const match = /^--expect-system=([a-zA-Z0-9_-]+):([a-zA-Z0-9._-]+)=(on|off)$/u.exec(arg);
  if (!match) throw new Error('Expected system must name shard:system=on|off');
  return { shard: match[1], id: match[2], present: match[3] === 'on' };
});
const nativeWalk=MODE.includes('walk')&&!TRAILS?runNativePhysicsWalk(ROOT,argv):undefined;
if(nativeWalk!==undefined){
  if(nativeWalk.status!==0)process.exit(nativeWalk.status);
  if(MODE.length===1)process.exit(0);
}
const { chromium, devices } = await import('playwright');
async function seedVariantFixtures(target) {
  if (Object.keys(SETTINGS).length > 0) await debugSettings(target, SETTINGS);
  for (const [key, data] of Object.entries(DEVICE_SAVES)) await saveFixture(target, { scope: 'device', key, data });
}
async function activationWitness(page, shard) {
  const witness = await page.evaluate(() => ({
    systems: Object.values(window.__wildshard.world.game.app.systemsByPhase()).flat().map((system) => system.id),
    deviceSaves: Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('wildshard.save.v2@1.device') ?? '{}').keys ?? {}).map(([key, value]) => [key, value.data])),
  }));
  for (const [key, value] of Object.entries(DEVICE_SAVES)) if (witness.deviceSaves[key] !== value) throw new Error(`Device fixture missing: ${key}`);
  for (const expected of EXPECTED_SYSTEMS.filter((row) => row.shard === shard)) if (witness.systems.includes(expected.id) !== expected.present) throw new Error(`Activation witness failed: ${expected.id} expected ${expected.present ? 'on' : 'off'}`);
  return witness;
}


const waitFor = async (fn, ms, what) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return; await new Promise((resolve) => { setTimeout(resolve, 250); }); } throw new Error(what); };

// ── build + preview ──
if (URL_BASE) { /* a running server: nothing to build or serve */ }
else if (!has('no-build')) { console.error('> pnpm build'); execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' }); }
else if (!existsSync(resolvePath(SERVE, 'dist/index.html'))) { console.error('dist/ missing; drop --no-build'); process.exit(2); }
let listening = URL_BASE !== '', exited = null;
// vite itself, not `npx vite`: killing an npx wrapper leaves the server holding the port
const preview = URL_BASE ? null : spawn(process.execPath, [resolvePath(ROOT, 'scripts/preview-server.mjs'), '--root', SERVE, '--port', String(PORT)], { cwd: SERVE, stdio: ['ignore', 'pipe', 'pipe'] });
// oxlint-disable-next-line no-control-regex -- stripping vite's ANSI colours (it bolds the port number)
preview?.stdout.on('data', (d) => { if (String(d).replaceAll(/\u001B\[[\d;]*m/g, '').includes(`:${PORT}/`)) listening = true; });
preview?.stderr.on('data', (d) => { process.stderr.write(`[preview] ${d}`); });
preview?.on('exit', (code) => { exited = code ?? 'signal'; });
const cleanup = () => { if (preview && !preview.killed) preview.kill('SIGTERM'); };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); });
await waitFor(() => { if (exited !== null) { console.error(`vite preview exited (${exited}) — is port ${PORT} taken? --port=<free>`); process.exit(2); } return listening; }, 20_000, 'vite preview did not come up');
const BASE = URL_BASE === '' ? `http://localhost:${PORT}` : URL_BASE;
let build = 'unknown';
try { build = (await (await fetch(`${BASE}/version.json`, { cache: 'no-store' })).json()).build ?? build; } catch { /* keep 'unknown' */ }
console.error(`> physics-baseline ${LABEL} build=${build} modes=${MODE.join(',')} cpu=${CPU}× (walk ${WALK_CPU}×)`);

while (existsSync(resolvePath(ROOT, '.git/quiet'))) await new Promise(resolve => { setTimeout(resolve, 1000); });
const browser = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--use-angle=metal', '--ignore-gpu-blocklist', '--mute-audio'] });
const result = { label: LABEL, build, tier: TIER, date: new Date().toISOString(), cpu: CPU, walkCpu: WALK_CPU, frames: FRAMES, poses: [], walk: [], grid: [], gridFailures: [], physics: {}, activation: {}, deviceSaves: DEVICE_SAVES, expectedSystems: EXPECTED_SYSTEMS, nativeWalk };

async function openGame(shard, q, { cpu, video }) {
  const ctx = await browser.newContext({ ...devices['iPhone 16 Pro'], ...(video ? { recordVideo: { dir: join(OUT_DIR, '.video-tmp'), size: { width: 390, height: 844 } } } : {}) });
  const page = await ctx.newPage();
  await seedVariantFixtures(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (ENTRY !== 'shard') await saveFixture(ctx, { scope: 'device', key: 'devMode', data: true });
  if (ENTRY === 'grid-only') {
    await enterPhysicsGrid(page, BASE, TIER, TIMEOUT_MS);
    const grid = await page.evaluate(physicsEntryInventory);
    if (grid.grid !== shard) throw new Error(`Grid starts in ${grid.grid}, expected ${shard}`);
    if (!physicsEntryPierReady(grid)) throw new Error('Pier deck has no matching registered/native floor');
    result.entry = { grid, parity: 'not-sampled' };
    console.error(JSON.stringify(result.entry));
  } else {
    await page.goto(`${BASE}/?chunk=${shard}&tier=${TIER}&skipintro=1&nolock=1&sw=0&mute=1${q ? `&${q}` : ''}${EXTRA_Q ? `&${EXTRA_Q}` : ''}`, { waitUntil: 'commit', timeout: TIMEOUT_MS });
    await waitForPhysicsBoot(page, 'standalone', TIMEOUT_MS);
    if (ENTRY === 'grid') {
      const standalone = await page.evaluate(physicsEntryInventory);
      await enterPhysicsGrid(page, BASE, TIER, TIMEOUT_MS);
      const grid = await page.evaluate(physicsEntryInventory);
      if (grid.grid !== shard) throw new Error(`Grid starts in ${grid.grid}, expected ${shard}`);
      const failures = physicsEntryFailures(standalone, grid);
      result.entry = { standalone, grid, failures };
      if (failures.length > 0) { console.error(JSON.stringify(result.entry)); await ctx.close(); throw new Error(failures.join('\n')); }
    }
  }
  await page.waitForTimeout(SETTLE_MS);
  try { result.activation[shard] = await activationWitness(page, shard); } catch (error) { await ctx.close(); throw error; }
  return { ctx, page, errors };
}

// ── grid: title entry, then continuous seam drives in both directions (no URL switch / fresh-document cell travel) ──
if (MODE.includes('grid')) {
  const ctx = await browser.newContext({ ...devices['iPhone 16 Pro'] }), page = await ctx.newPage(), errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); });
  page.on('console', (message) => { if (message.type() === 'error' && message.text().startsWith('[faults]')) errors.push(message.text()); });
  await saveFixture(ctx, { scope: 'device', key: 'devMode', data: true });
  await seedVariantFixtures(ctx);
  try {
    if (WALK_CPU > 1) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: WALK_CPU });
    await page.goto(`${BASE}/?tier=${TIER}&mute=1&nolock=1&sw=0`, { waitUntil: 'commit', timeout: TIMEOUT_MS });
    await page.locator('.ws-main-grid').waitFor({ timeout: TIMEOUT_MS }); // the main menu's INFINITE WILDSHARD card (SF21a)
    await page.evaluate(() => { setTimeout(() => { document.querySelector('.ws-main-grid')?.click(); }, 100); }); // the tap navigates: return first
    await page.waitForFunction(() => !document.querySelector('.ws-load') && window.__wildshard?.shard?.grid?.state().live?.live !== undefined, null, { timeout: TIMEOUT_MS, polling: 250 });
    await page.evaluate(() => { window.__wildshard.world.hud.enterNow(); });
    // the sky-down reveal (G98) drops the player's input while it runs: skip it with its one tap and wait for its end
    await page.mouse.click(195, 420).catch(() => undefined);
    await page.waitForFunction(() => window.__wsReveal === undefined || (window.__wsReveal.endedMs ?? null) !== null, null, { timeout: 60000, polling: 250 }).catch(() => undefined);
    result.activation.grid = await activationWitness(page, 'grid');
    await page.waitForTimeout(SETTLE_MS);
    for (const speed of [15, 30]) {
      const state = await page.evaluate(() => window.__wildshard.shard.grid.state()), route = gridSeamRoute(state, speed);
      console.error(`> grid ${speed} m/s ${route.home} → deck → ${route.peer} → deck → ${route.home}`);
      const drive = await page.evaluate(driveGridSeam, route), failures = gridDriveFailures(drive);
      result.grid.push(drive); result.gridFailures.push(...failures.map((failure) => `${speed} m/s: ${failure}`));
      if (failures.length > 0) break;
    }
  } catch (error) { result.gridFailures.push(error instanceof Error ? error.message : String(error)); }
  finally { await ctx.close(); }
  result.gridErrors = errors; result.gridFailures.push(...errors.map((error) => `page: ${error}`));
}

// ── poses ──
if (MODE.includes('poses')) {
  for (const pose of POSES) {
    if (ONLY && pose.shard !== ONLY) continue;
    console.error(`> pose ${pose.shard} ${pose.name}`);
    const { ctx, page, errors } = await openGame(pose.shard, pose.q, { cpu: CPU, video: false });
    try {
      const r = await page.evaluate(async (frames) => {
        const w = window.__wildshard?.world, g = w.game;
        const cur = { update: 0, fixed: 0, world: 0, player: 0, animals: 0, render: 0 }, restore = [];
        const wrap = (obj, key, bucket) => {
          const orig = obj[key];
          if (typeof orig !== 'function') throw new Error(`Physics pose requires ${key}`);
          const timed = function timed(...args) { const at = performance.now(); try { return orig.apply(this, args); } finally { cur[bucket] += performance.now() - at; } };
          obj[key] = timed;
          restore.push(() => { if (obj[key] === timed) obj[key] = orig; });
        };
        try {
          // Game's callback arrays retired with the app registry. Time the live system rows that Game.runPhase uses,
          // preserving their ordering, predicates, scheduler, receiver and arguments. Never report missing phases as zero.
          const phases = g.app.systemsByPhase();
          const buckets = { input: 'fixed', 'fixed.pre': 'fixed', 'fixed.step': 'world', 'fixed.post': 'fixed', update: 'update' };
          for (const [phase, bucket] of Object.entries(buckets)) {
            const systems = phases[phase];
            if (!Array.isArray(systems)) throw new Error(`Physics pose requires live system phase ${phase}`);
            for (const system of systems) wrap(system, 'run', bucket);
          }
          wrap(w.player, 'update', 'player'); wrap(w.animals, 'update', 'animals'); wrap(g.composer, 'render', 'render');
          if (w.player.step) wrap(w.player, 'step', 'player');
          const rows = [];
          let last = performance.now();
          for (let n = 0; n < frames; n++) {
            await new Promise((resolve) => { requestAnimationFrame(() => { resolve(undefined); }); });
            const now = performance.now();
            const steps = g.fixedSteps ?? 0;
            cur.fixed += cur.world; // "fixed" stays input + every fixed phase (the P9 column); "world" is the Rapier step phase alone
            rows.push({ ...cur, js: cur.update + cur.fixed, steps, perStep: steps > 0 ? cur.fixed / steps : 0, frame: now - last, calls: g.lastFrame.calls, tris: g.lastFrame.triangles });
            last = now; cur.update = 0; cur.fixed = 0; cur.world = 0; cur.player = 0; cur.animals = 0; cur.render = 0;
          }
          const motors = w.animals.animals.filter((a) => a.motor).length;
          return { rows, animals: w.animals.animals.length, motors, pos: { x: w.player.position.x, y: w.player.position.y, z: w.player.position.z } };
        } finally { for (const undo of restore.reverse()) undo(); }
      }, FRAMES);
      const pct = (k, p) => { const v = r.rows.map((x) => x[k]).sort((a, b) => a - b); return Math.round(v[Math.min(v.length - 1, Math.floor(v.length * p))] * 100) / 100; };
      result.poses.push({
        shard: pose.shard, name: pose.name, animals: r.animals, motors: r.motors, stepsP50: pct('steps', 0.5), perStepP50: pct('perStep', 0.5), perStepP95: pct('perStep', 0.95), worldP50: pct('world', 0.5), worldP95: pct('world', 0.95),
        updateP50: pct('js', 0.5), updateP95: pct('js', 0.95), fixedP50: pct('fixed', 0.5), fixedP95: pct('fixed', 0.95), playerP50: pct('player', 0.5), playerP95: pct('player', 0.95),
        animalsP50: pct('animals', 0.5), animalsP95: pct('animals', 0.95), renderP50: pct('render', 0.5), renderP95: pct('render', 0.95),
        frameP50: pct('frame', 0.5), frameP95: pct('frame', 0.95), calls: pct('calls', 0.5), trisM: Math.round(pct('tris', 0.5) / 1e4) / 100, errors,
      });
    } finally { await ctx.close(); }
  }
}

// ── walk ──
if (MODE.includes('walk')&&TRAILS) {
  // --route=<file>: another route file in the same shape (a row's own legs, e.g. SF46's entries), default the shared one
  const route = JSON.parse(readFileSync(resolvePath(ROOT, flag('route', 'scripts/physics-route.json')), 'utf8'));
  for (const [shard, legs] of Object.entries(route)) {
    if (shard.startsWith('$') || (ONLY && shard !== ONLY)) continue;
    const first = legs[0];
    const { ctx, page, errors } = await openGame(shard, `x=${first.start.x}&z=${first.start.z}&yaw=${first.start.yaw}`, { cpu: WALK_CPU, video: VIDEO });
    result.physics[shard] = await page.evaluate(() => ({ colliders: window.__wildshard.world.physics.world.colliders.len() }));
    if (TRAILS) {
      const paths = (await page.evaluate(() => window.__hf.TRAILS)).slice(4);
      // a path whose bed runs beside the structure that carries it (route `$trails`: a stair flight down a cliff inside
      // a baked area, where the bed can't move) is walked over that structure: vertex `at` is replaced by `with`
      for (const v of route.$trails?.[shard] ?? []) {
        const path = paths[v.path], k = path?.findIndex(([x, z]) => x === v.at[0] && z === v.at[1]) ?? -1;
        if (!path || k < 0) throw new Error(`$trails ${shard}: path ${v.path} has no vertex ${v.at.join(', ')}`);
        path.splice(k, 1, ...v.with);
      }
      // a path's ends under a deck (Nalati's sky road starts under the bridge's south ramp: the ramp's foot is where it
      // joins the road) are drawn, not walked: its points more than 0.5 m under a registered floor are trimmed off the ends
      const under = await page.evaluate((ps) => ps.map((path) => path.map(([x, z]) => {
        const f = window.__wildshard.world.registry?.floorAt(x, z);
        return f !== undefined && f - window.__hf.heightAt(x, z) > 0.5;
      })), paths.map((path) => {
        const pts = [];
        for (let k = 1; k < path.length; k++) {
          const [ax, az] = path[k - 1], [bx, bz] = path[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
          for (let j = k === 1 ? 0 : 1; j <= n; j++) pts.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n]);
        }
        return pts;
      }));
      legs.length = 0;
      paths.forEach((path, i) => {
        const all = [];
        for (let k = 1; k < path.length; k++) {
          const [ax, az] = path[k - 1], [bx, bz] = path[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
          for (let j = k === 1 ? 0 : 1; j <= n; j++) all.push({ x: ax + (bx - ax) * j / n, z: az + (bz - az) * j / n });
        }
        const flags = under[i] ?? [];
        let a = 0, b = all.length;
        while (a < b && flags[a] === true) a++;
        while (b > a && flags[b - 1] === true) b--;
        const kept = all.slice(a, b);
        if (kept.length < 2) return;
        for (const dir of ['fwd', 'back']) {
          const pts = dir === 'fwd' ? kept : [...kept].reverse();
          const [s0, ...wps] = pts;
          legs.push({ name: `path${i}-${dir}`, start: { x: s0.x, z: s0.z, yaw: Math.atan2(-(wps[0].x - s0.x), -(wps[0].z - s0.z)) }, waypoints: wps, timeout: 240 });
        }
      });
    }
    console.error(`> walk ${shard} (${legs.length} legs)`);
    try {
      const selected = legs.filter((routeLeg) => !ONLY_LEG || routeLeg.name === ONLY_LEG);
      if (ONLY_LEG && selected.length === 0) throw new Error(`Unknown leg ${ONLY_LEG} in ${shard}`);
      for (const leg of selected.flatMap((routeLeg) => Array.from({ length: REPEAT }, () => routeLeg))) {
        const r = await page.evaluate(walkPhysicsLeg, leg);
        const grid = ENTRY === 'shard' ? undefined : await page.evaluate(() => {
          const api = window.__wildshard;
          return { live: api.shard.grid.state().live, clock: api.app.clock, frameGate: api.world.game.frameGate(),
            entered: api.world.hud.entered, paused: api.world.hud.paused };
        });
        const ys = r.trace.map((s) => s[2]);
        const last = r.trace.at(-1) ?? [0, Number.NaN, Number.NaN, Number.NaN];
        const speeds = [];
        for (let i = 1; i < r.trace.length; i++) { const a = r.trace[i - 1], b = r.trace[i], dt = b[0] - a[0]; if (dt > 0 && b[5] === 1) speeds.push(Math.hypot(b[1] - a[1], b[3] - a[3]) / dt); }
        speeds.sort((a, b) => a - b);
        const summary = {
          shard, name: leg.name, frames: r.trace.length, seconds: Math.round((last[0] ?? 0) * 10) / 10,
          end: { x: last[1], y: last[2], z: last[3] }, expectY: leg.expect?.y ?? null, maxY: Math.round(Math.max(...ys) * 100) / 100,
          groundSpeedP50: Math.round((speeds[Math.floor(speeds.length / 2)] ?? 0) * 100) / 100,
          airFrames: r.trace.filter((s) => s[5] === 0).length, swimFrames: r.trace.filter((s) => s[7] === 1).length, slideFrames: r.trace.filter((s) => s[8] === 1).length,
          stuck: r.stuck, trace: r.trace, ...(leg.inside ? { out: r.out, minY: Math.round(Math.min(...ys) * 100) / 100 } : {}),
          complete: r.complete, timedOut: r.timedOut,
          grid,
        };
        result.walk.push(summary);
        console.error(`  ${leg.name}: ${summary.seconds}s end y ${summary.end.y} (expect ${summary.expectY ?? '?'}) stuck ${summary.stuck.length}${leg.inside ? ` · out ${r.out} frames, min y ${summary.minY}` : ''}`);
        if (!r.complete || r.timedOut) break;
      }
      result.walkErrors = [...(result.walkErrors ?? []), ...errors.map((e) => `${shard}: ${e}`)];
    } finally {
      const video = page.video();
      await ctx.close();
      if (video) {
        const src = await video.path();
        const dst = join(OUT_DIR, `${LABEL}-walk-${shard}.mp4`);
        // the raw webm is ~10 MB a shard: re-encode small (half size, h264) so the clips can live in git
        try { execSync(`ffmpeg -y -loglevel error -i "${src}" -vf scale=196:-2 -c:v libx264 -crf 34 -preset slow -pix_fmt yuv420p -an "${dst}"`); rmSync(src); }
        catch { renameSync(src, dst.replace(/\.mp4$/, '.webm')); }
        console.error(`  video ${dst}`);
      }
    }
  }
  const tmp = join(OUT_DIR, '.video-tmp');
  if (existsSync(tmp) && readdirSync(tmp).length === 0) rmSync(tmp, { recursive: true });
}

await browser.close();
mkdirSync(OUT_DIR, { recursive: true });
const file = join(OUT_DIR, `${LABEL}-${build}.json`);
// a poses run and a walk run of the same build share one file: keep what this run didn't measure
if (existsSync(file)) {
  const prev = JSON.parse(readFileSync(file, 'utf8'));
  if (result.poses.length === 0) result.poses = prev.poses ?? [];
  if (result.walk.length === 0 && nativeWalk === undefined) result.walk = prev.walk ?? [];
}
writeFileSync(file, `${JSON.stringify(result)}\n`);

console.log(`\n### ${LABEL} — build ${build}, ${TIER} tier 390×844, ${CPU}× CPU (walk ${WALK_CPU}×), ${FRAMES} frames per pose\n`);
if (result.poses.length > 0) {
  console.log('| pose | animals (motors) | frame JS ms p50 / p95 | of it: input + fixed steps | steps / frame | per step p50 / p95 | Rapier step phase | player | animals.update | render | rAF ms p50 / p95 | calls | tris M |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of result.poses) console.log(`| ${p.shard} ${p.name} | ${p.animals} (${p.motors ?? '?'}) | ${p.updateP50} / ${p.updateP95} | ${p.fixedP50 ?? 0} / ${p.fixedP95 ?? 0} | ${p.stepsP50 ?? '?'} | ${p.perStepP50 ?? '?'} / ${p.perStepP95 ?? '?'} | ${p.worldP50 ?? '?'} / ${p.worldP95 ?? '?'} | ${p.playerP50} / ${p.playerP95} | ${p.animalsP50} / ${p.animalsP95} | ${p.renderP50} / ${p.renderP95} | ${p.frameP50} / ${p.frameP95} | ${p.calls} | ${p.trisM} |`);
}
if (result.walk.length > 0) {
  console.log('\n| leg | s | end (x, y, z) | expect y | max y | ground speed p50 m/s | air / swim / slide frames | stuck |\n|---|---|---|---|---|---|---|---|');
  for (const l of result.walk) console.log(`| ${l.shard} ${l.name} | ${l.seconds} | ${l.end.x}, ${l.end.y}, ${l.end.z} | ${l.expectY ?? '—'} | ${l.maxY} | ${l.groundSpeedP50} | ${l.airFrames} / ${l.swimFrames} / ${l.slideFrames} | ${l.stuck.length > 0 ? l.stuck.map((s) => `wp${s.wp}@${s.x},${s.y},${s.z}`).join(' ') : '—'}${l.out === undefined ? '' : ` · out ${l.out} (min y ${l.minY})`} |`);
}
console.log(`\n→ ${file}`);
if (MODE.includes('grid')) {
  for (const drive of result.grid) console.log(`grid ${drive.speed} m/s: ${drive.crossingDelta} crossings, ${drive.stuck.length} stuck, completed=${drive.complete}`);
  for (const failure of result.gridFailures) console.error(`grid FAIL: ${failure}`);
}
cleanup();
process.exit(result.gridFailures.length > 0 || MODE.includes('walk') && result.walk.some(leg => leg.stuck.length > 0 || !leg.complete || leg.timedOut) || (result.walkErrors?.length ?? 0) > 0 ? 1 : 0); // the preview child would keep the event loop alive
