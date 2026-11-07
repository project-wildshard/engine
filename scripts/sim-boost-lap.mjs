#!/usr/bin/env node
// DL17 (download mini-plan, G1000): the complete-at-control gate's boost lap on the iOS Simulator, recorded. One fresh
// Safari visit of a served shard (worker, caches and storage cleared first), Developer on, phone tier, 2x, muted; the
// baseline snapshot in the control frame; then the level's walk legs within reach of spawn (scripts/physics-route.json)
// on the hoverboard at Developer boost, each driven again on foot if the board cannot pass it, sampled every 500 ms
// while `simctl recordVideo` films the screen. A pop is what scripts/complete-at-control-snapshot.mjs `lapPops` counts.
//
//   scripts/sim-lane.sh run --max 30 wildshard-iphone node scripts/sim-boost-lap.mjs --base=URL --rev=SHA
//     [--flow=driftwood-isle] [--level-download=shardfile|packs] [--reach=220] [--memory=on] [--out=tmp/sim-boost-lap/<label>]
// --memory=on samples the game's WebContent native footprint with scripts/sim-mem-phases.py (sim-memory's sampler): its
// high per phase, loading (to control), control (5 s standing) and lap.
// --base is a served preview of --rev (scripts/serve-build.sh --rev): Safari's inspector cannot inject a script before
// navigation, so the harness pins and the control-frame snapshot go in a copy of the served entry HTML (frame-floor's
// method), dl17-sim.html; compiled JS and assets stay byte-identical. Exit 0 = 0 pops, 1 = pops, 2 = no reading.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { soakInspector } from './soak/inspector.mjs';
import { saveFixtureCode, harnessPinCode, levelDownloadFixtures } from './debug-settings.mjs';
import { snapshot, lapPops } from './complete-at-control-snapshot.mjs';

const { values } = parseArgs({ options: Object.fromEntries(['base', 'rev', 'flow', 'level-download', 'reach', 'out', 'memory'].map(key => [key, { type: 'string' }])) });
const base = (values.base ?? '').replace(/\/$/u, ''), rev = values.rev ?? '', flow = values.flow ?? 'driftwood-isle', reach = Number(values.reach ?? '220');
const levelDownload = values['level-download'];
if (!/^https?:\/\//u.test(base) || !/^[0-9a-f]{7,40}$/u.test(rev) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(flow) || flow === 'grid' || !(reach > 0)
  || ![undefined, 'shardfile', 'packs'].includes(levelDownload)) {
  console.error('usage: sim-boost-lap.mjs --base=URL --rev=SHA [--flow=<shard slug>] [--level-download=shardfile|packs] [--reach=220] [--out=tmp/sim-boost-lap/<label>]');
  process.exit(2);
}
const udid = process.env.SIM_UDID;
if (udid === undefined || udid === '') throw new Error('Run under scripts/sim-lane.sh run (it sets SIM_UDID)');
const out = resolvePath(values.out ?? `tmp/sim-boost-lap/${flow}-${rev.slice(0, 10)}-${levelDownload ?? 'default'}`);
if (!out.startsWith(`${resolvePath('tmp')}/`)) { console.error('--out must be under ./tmp'); process.exit(2); }
mkdirSync(out, { recursive: true });
const memory = values.memory === 'on', phaseFile = join(out, 'phase');
const report = { schema: 1, gate: 'DL17 Simulator boost lap', rev, base, flow, reach, levelDownload: levelDownload ?? null, when: new Date().toISOString(), errors: [], legs: [] };

const version = await (await fetch(`${base}/version.json`)).json();
if (typeof version.build !== 'string' || !version.build.startsWith(rev.slice(0, 7))) throw new Error(`Served build ${version.build} is not ${rev}`);
report.build = version.build;
// the helper entry: settings, Developer, the Level download row, the harness pins and the control-frame snapshot, then
// the served index.html unchanged
const registry = readFileSync(join(process.env.HOME ?? '', '.dev-servers', new URL(base).port), 'utf8').trim().split(' ');
const dist = join(registry[2], 'dist');
const prelude = [
  saveFixtureCode({ scope: 'device', key: 'devMode', data: true }),
  saveFixtureCode({ scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } }),
  saveFixtureCode({ scope: 'global', key: 'gfx', data: { dpr: '2', aa: 'auto' } }),
  ...(levelDownload === undefined ? [] : levelDownloadFixtures(levelDownload).map(saveFixtureCode)),
  harnessPinCode({ seed: 357, browser: 'Safari / iOS Simulator', lane: 'dl17-sim', sha: rev }),
  `window.__dl17Reach=${JSON.stringify(reach)};window.__dl17Snapshot=${snapshot.toString()}`,
  "document.addEventListener('ws:control-ready',()=>{requestAnimationFrame(()=>{window.__dl17AtControl=window.__dl17Snapshot();window.__dl17ControlMs=performance.now();});},{once:true})",
].join(';');
writeFileSync(join(dist, 'dl17-sim.html'), readFileSync(join(dist, 'index.html'), 'utf8').replace('<head>', `<head><script>${prelude}</script>`));

const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });
let page = null, recorder = null, sampler = null;
const phase = name => { if (memory) writeFileSync(phaseFile, name); };
async function connect(prefix) {
  if (page !== null) { page.close(); page = null; }
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    for (let port = 9232; port <= 9240; port++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
        const found = pages.find(row => typeof row.url === 'string' && row.url.startsWith(prefix));
        if (found !== undefined) { page = soakInspector(found.webSocketDebuggerUrl); await page.opened; await sleep(700); await page.evaluate('1'); return; }
      } catch { if (page !== null) { page.close(); page = null; } }
    }
    await sleep(300);
  }
  throw new Error(`No inspector page for ${prefix}`);
}
async function until(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await page.evaluate(expression)) return true; } catch { /* the page navigates */ } await sleep(250); }
  return false;
}
/** A JSON reading of the page (the inspector does not await promises on WebKit). */
const read = async expression => JSON.parse(await page.evaluate(`JSON.stringify(${expression})`) ?? 'null');

try {
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
  await sleep(2000);
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${base}/version.json`]);
  await connect(`${base}/version.json`);
  // a first visit: no worker, no caches, no saves
  await page.evaluate(`window.__dl17Reset = null; (async () => {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
    localStorage.clear(); sessionStorage.clear();
    window.__dl17Reset = 'done';
  })().catch(error => { window.__dl17Reset = String(error); }); 1`);
  if (!await until("window.__dl17Reset !== null", 30000) || await page.evaluate('window.__dl17Reset') !== 'done') throw new Error('The Safari reset did not finish');
  const query = new URLSearchParams({ chunk: flow, tier: 'phone', skipintro: '1', nolock: '1', mute: '1' });
  const opened = Date.now();
  if (memory) {
    phase('loading');
    sampler = spawn('python3', [resolvePath('scripts/sim-mem-phases.py'), '--device', udid, '--phase-file', phaseFile, '--out', join(out, 'native.jsonl'), '--max', '900'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let printed = ''; sampler.stdout.on('data', data => { printed += String(data); }); sampler.on('exit', () => { report.memoryRaw = printed; });
    await sleep(1000);
  }
  await page.evaluate(`setTimeout(() => location.replace('/dl17-sim.html?${query}'), 50); 1`);
  await sleep(800);
  await connect(`${base}/dl17-sim.html`);
  if (!await until('window.__dl17AtControl !== undefined', 300000)) throw new Error('No control within 300 s');
  report.openToControlMs = Date.now() - opened;
  // the level Safari booted (a route can fall back to another level)
  report.level = await read('window.__wildshard?.world?.game?.level?.id ?? null');
  if (report.level !== flow) throw new Error(`Safari booted ${String(report.level)}, not ${flow}`);
  const at = await read('window.__dl17AtControl');
  report.atControl = { marks: at.marks, textures: at.textures, lods: at.scene?.lods ?? [], texturesPending: at.scene?.texturesPending ?? [], meshes: at.scene?.meshes ?? null, player: at.scene?.player ?? null };

  phase('control'); await sleep(memory ? 5000 : 0); phase('lap');
  const video = join(out, 'lap.mp4');
  recorder = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', video], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(resolve => {
    const on = data => { if (/Recording started/iu.test(String(data))) resolve(); };
    recorder.stdout.on('data', on); recorder.stderr.on('data', on); setTimeout(resolve, 8000);
  });
  const [px, , pz] = at.scene?.player ?? [0, 0, 0];
  const legs = (JSON.parse(readFileSync(resolvePath('scripts/physics-route.json'), 'utf8'))[flow] ?? [])
    .filter(leg => Math.hypot(leg.start.x - px, leg.start.z - pz) <= reach);
  if (legs.length === 0) throw new Error(`No walk leg of ${flow} starts within ${reach} m of spawn`);
  const lap = [];
  /** One run of a leg in the page, sampled while it drives; complete as the Chromium gate counts it. */
  const drive = async (leg, hover) => {
    let metres = 0;
    for (let i = 0, from = leg.start; i < leg.waypoints.length; from = leg.waypoints[i], i++) metres += Math.hypot(leg.waypoints[i].x - from.x, leg.waypoints[i].z - from.z);
    const seconds = Math.ceil(metres / (hover ? 10 : 4) + 15);
    await page.evaluate(`window.__dl17Walk = null; (() => {
      const api = window.__wildshard; if (${hover}) api.requireWorld().player.hoverBoost = true;
      const leg = ${JSON.stringify({ name: `dl17-${leg.name}`, start: { ...leg.start, hover }, waypoints: leg.waypoints, timeout: seconds, stuckSeconds: 5 })};
      api.walkLeg(leg).then(r => {
        let top = 0; for (let k = 1; k < r.trace.length; k++) { const a = r.trace[k - 1], b = r.trace[k]; if (b[0] > a[0]) top = Math.max(top, Math.hypot(b[1] - a[1], b[3] - a[3]) / (b[0] - a[0])); }
        const passed = new Set(r.trace.map(f => f[9])), last = leg.waypoints[leg.waypoints.length - 1];
        window.__dl17Walk = { stuck: r.stuck, seconds: r.seconds, end: r.end, frames: r.trace.length, passed: passed.size,
          ordered: r.trace.every((f, i) => i === 0 || f[9] >= r.trace[i - 1][9]), off: Math.hypot(r.end.x - last.x, r.end.z - last.z), top };
      }, e => { window.__dl17Walk = { error: String(e) }; });
      setTimeout(() => { if (${hover}) api.requireWorld().player.hoverBoost = true; }, 300);
    })(); 1`);
    const end = Date.now() + seconds * 1000 + 5000;
    let result = null;
    while (Date.now() < end) {
      lap.push(await read('window.__dl17Snapshot()'));
      result = await read('window.__dl17Walk');
      if (result !== null) break;
      await sleep(500);
    }
    const complete = result !== null && result.error === undefined && result.frames > 0 && result.ordered && result.passed === leg.waypoints.length
      && result.stuck.length === 0 && result.seconds < seconds && result.off <= 3;
    return { leg: leg.name, on: hover ? 'board' : 'foot', complete, bound: seconds, ...(result ?? { error: 'no result' }) };
  };
  for (const leg of legs) {
    const runs = [await drive(leg, true)];
    if (!runs[0].complete) runs.push(await drive(leg, false));
    report.legs.push(...runs);
    if (!runs.at(-1).complete) report.errors.push(`the ${leg.name} leg did not complete on board or on foot`);
  }
  lap.push(await read('window.__dl17Snapshot()'));
  recorder.kill('SIGINT'); await new Promise(resolve => { recorder.once('exit', resolve); setTimeout(resolve, 15000); }); recorder = null;
  report.video = video;
  report.samples = lap.length;
  report.lapComplete = legs.every(leg => report.legs.some(r => r.leg === leg.name && r.complete));
  const boards = report.legs.filter(r => r.on === 'board');
  report.boost = { engaged: boards.length > 0 && lap.every(s => s.scene?.boost !== false), travelledTop: Math.max(0, ...boards.map(r => r.top ?? 0)) };
  if (!report.boost.engaged) report.errors.push('boost never engaged on the board');
  const found = lapPops(at, lap, undefined);
  report.pops = found;
  const count = found.fine.length + found.pops.length + found.textures.length;
  report.pass = report.errors.length > 0 ? null : count === 0;
} catch (error) {
  report.errors.push(String(error)); report.pass = null;
} finally {
  if (recorder !== null) recorder.kill('SIGINT');
  if (page !== null) page.close();
  if (sampler !== null) {
    phase('done'); await new Promise(resolve => { sampler?.once('exit', resolve); setTimeout(resolve, 15000); });
    const summary = (report.memoryRaw ?? '').split('\n').map(line => { try { return JSON.parse(line); } catch { return null; } }).findLast(row => row?.phases !== undefined);
    report.memory = summary === undefined ? null : Object.fromEntries(Object.entries(summary.phases).map(([name, row]) => [name, { gameHighGB: row.gameHighGB, gpuProcessGB: row.gpuProcessGB }]));
    delete report.memoryRaw;
  }
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
  proxy.kill();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
}
const p = report.pops;
const lines = [`DL17 Simulator boost lap ${flow} ${report.build ?? rev}${levelDownload === undefined ? '' : ` (${levelDownload})`}: ${report.pass === null ? 'NO READING' : report.pass ? '0 POPS' : 'POPS'}`];
if (p !== undefined) lines.push(`  fine ${p.fine.length}, meshes ${p.pops.length} (${p.pops.slice(0, 4).join('; ')}), textures ${p.textures.length}; distance LOD (listed, not red) ${p.distanceLod.length + p.lods.length}, actors ${p.actors.length}`);
if (report.memory !== undefined) lines.push(`  native memory high: ${Object.entries(report.memory ?? {}).map(([name, row]) => `${name} ${row.gameHighGB} GB`).join(', ')}`);
lines.push(`  legs ${report.legs.map(r => `${r.leg}:${r.on}:${r.complete ? 'ok' : 'no'}`).join(' ')}, boost ${JSON.stringify(report.boost ?? null)}`);
if (report.errors.length > 0) lines.push(`  errors: ${report.errors.slice(0, 3).join(' | ')}`);
lines.push(`  report ${join(out, 'report.json')}${existsSync(join(out, 'lap.mp4')) ? `, clip ${join(out, 'lap.mp4')}` : ''}`);
console.log(lines.join('\n'));
process.exit(report.pass === null ? 2 : report.pass ? 0 : 1);
