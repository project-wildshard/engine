#!/usr/bin/env node
// sim-probe.mjs: SF22a's iOS Simulator memory reading (iPhone 17 Pro, Safari), each target on a cold Safari.
//
//   node scripts/crossroads-rig/sim-probe.mjs --base=http://127.0.0.1:4400/ --shard=_template … [--rig=<query>=<label> …]
//        [--settle=15] [--measure=15] --out=<dir>
// It runs itself inside scripts/sim-lane.sh run (one booted Simulator machine-wide; shut down after). Per target: Safari
// terminated and relaunched on /version.json, Web Inspector attached (ios_webkit_debug_proxy, as scripts/nine-sim-memory.mjs),
// the kernel sampler started (scripts/sim-mem-phases.py, 100 ms, the game tab's WebContent physical footprint + the
// WebKit GPU process), then the page: a shard loads `?chunk=<slug>&skipintro=1&nolock=1&mute=1` (entered as the start
// title's ENTER WORLD stores it), settles, measures; the rig (stage.sh) follows window.__rig.phase.
// Writes <out>/<label>.{native,inspector}.jsonl and <out>/summary.json (the medians per phase, decimal MB).
// A REGRESSION / RELATIVE CHECK, NOT PHONE EVIDENCE: the Simulator runs on the Mac's memory and GPU (ios-simulator skill).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, createWriteStream } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { saveFixtureCode } from '../debug-settings.mjs';

const ROOT = resolvePath(new URL('../..', import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, d) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const flags = (name) => argv.filter((x) => x.startsWith(`--${name}=`)).map((x) => x.slice(name.length + 3));
const DEVICE = 'wildshard-iphone';
const mb = (b) => Math.round(b / 1e5) / 10;
const median = (a) => { if (a.length === 0) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function inspectorPage(base) {
  for (let i = 0; i < 30; i++) {
    try {
      const pages = await (await fetch('http://127.0.0.1:9232/json')).json();
      const page = pages.find((p) => typeof p.url === 'string' && p.url.startsWith(base));
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* the proxy is still starting */ }
    await sleep(1000);
  }
  throw new Error(`no Safari page on ${base} in the Web Inspector list`);
}
// the raw WebKit protocol through the proxy's Target.* multiplexing (as scripts/nine-sim-memory.mjs)
function connect(wsUrl, onMemory) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const conn = { target: /** @type {string | null} */ (null) };
  const pending = new Map();
  const raw = (m) => { ws.send(JSON.stringify(m)); };
  const send = (method, params = {}) => {
    const id = ++seq;
    const p = new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); });
    if (conn.target) raw({ id: ++seq, method: 'Target.sendMessageToTarget', params: { targetId: conn.target, message: JSON.stringify({ id, method, params }) } });
    else raw({ id, method, params });
    return p;
  };
  const track = () => Promise.race([send('Memory.enable').then(() => send('Memory.startTracking')).catch(() => null), sleep(3000)]);
  const inner = (m) => {
    if (m.method === 'Memory.trackingUpdate') { onMemory(m.params.event.categories); return; }
    const p = m.id ? pending.get(m.id) : undefined;
    if (p) { pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
  };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data));
    if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { conn.target = m.params.targetInfo.targetId; return; }
    if (m.method === 'Target.didCommitProvisionalTarget') { conn.target = m.params.newTargetId; void track(); return; }
    if (m.method === 'Target.dispatchMessageFromTarget') { inner(JSON.parse(m.params.message)); return; }
    inner(m);
  });
  const opened = new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const evaluate = async (expression, fallback = null) => {
    try {
      const r = await Promise.race([send('Runtime.evaluate', { expression, returnByValue: true }), sleep(5000).then(() => null)]);
      return r?.result?.value ?? fallback;
    } catch { return fallback; }
  };
  return { opened, send, track, evaluate, close: () => { ws.close(); } };
}

async function oneRun(udid, run, opts) {
  const { out, base } = opts;
  const phaseFile = join(out, `${run.label}.phase`);
  writeFileSync(phaseFile, 'idle');
  spawnSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari']);
  await sleep(3000);
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${base}version.json`]);
  await sleep(6000);
  const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
  const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240', '-F'], { stdio: 'ignore' });
  const log = createWriteStream(join(out, `${run.label}.inspector.jsonl`), { flags: 'w' });
  let phase = 'idle';
  const samples = [];
  const t0 = Date.now();
  const say = (s) => { console.log(`[${run.label} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${s}`); };
  const setPhase = (p) => { phase = p; writeFileSync(phaseFile, p); log.write(`${JSON.stringify({ at: Date.now(), kind: 'phase', phase: p })}\n`); say(`phase ${p}`); };
  let page = null, sampler = null;
  const result = { label: run.label, kind: run.kind };
  try {
    page = connect(await inspectorPage(base), (cats) => {
      const bytes = cats.reduce((s, c) => s + c.size, 0);
      samples.push({ phase, bytes, cats: Object.fromEntries(cats.map((c) => [c.type, c.size])) });
      log.write(`${JSON.stringify({ at: Date.now(), kind: 'memory', phase, bytes })}\n`);
    });
    await page.opened;
    await sleep(700);
    await page.track();
    sampler = spawn('python3', [join(ROOT, 'scripts/sim-mem-phases.py'), '--device', udid, '--phase-file', phaseFile,
      '--out', join(out, `${run.label}.native.jsonl`), '--max', '900'], { stdio: 'ignore' });
    const samplerDone = new Promise((resolve) => { sampler?.on('exit', resolve); });
    await sleep(1500);
    const { evaluate } = page;
    setPhase('blank');
    await sleep(4000);
    if (run.kind === 'shard') {
      const arrival = { slug: run.slug, mode: 'enter', at: Date.now() };
      await evaluate(`${saveFixtureCode({ scope: 'session', key: 'titleArrival', data: arrival })};${saveFixtureCode({ scope: 'device', key: 'titleArrival.once', data: arrival })};1`);
      setPhase('loading');
      const loadStart = Date.now();
      await evaluate(`location.href = ${JSON.stringify(`${base}?chunk=${run.slug}&skipintro=1&nolock=1&mute=1`)}; 1`);
      await sleep(2000);
      for (;;) {
        const v = JSON.parse(await evaluate('JSON.stringify({ world: Boolean(window.__wildshard?.world), loading: Boolean(document.querySelector(".ws-load")), err: document.querySelector("#wserr .msg")?.textContent ?? null })', 'null'));
        if (v?.err) throw new Error(`the game's error screen: ${v.err}`);
        if (v?.world && !v.loading) break;
        if (Date.now() - loadStart > 300_000) throw new Error('the load did not finish in 300 s');
        await sleep(500);
      }
      result.loadSeconds = (Date.now() - loadStart) / 1000;
      if ((await evaluate('document.querySelector("#hud")?.classList.contains("intro") === true')) === true) await evaluate('document.querySelector(".ws-menu-play")?.click(); 1');
      setPhase('settle');
      await sleep(opts.settle * 1000);
      // true display frames (requestAnimationFrame ticks); renderer.info.render.frame counts every render() call (passes)
      await evaluate('window.__sfRaf = 0; (function tick() { window.__sfRaf++; requestAnimationFrame(tick); })(); 1');
      const frame = 'window.__sfRaf ?? null';
      const f0 = await evaluate(frame), a = Date.now();
      setPhase('measure');
      await sleep(opts.measure * 1000);
      const f1 = await evaluate(frame);
      if (typeof f0 === 'number' && typeof f1 === 'number') result.fps = Math.round(((f1 - f0) / ((Date.now() - a) / 1000)) * 10) / 10;
      result.renderer = JSON.parse(await evaluate('JSON.stringify((() => { const r = window.__wildshard?.world?.game?.renderer; return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles, textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length ?? null, drawingBuffer: [r.domElement.width, r.domElement.height] } : null; })())', 'null'));
    } else {
      await evaluate(`location.href = ${JSON.stringify(`${base}crossroads-rig/index.html?${run.query}`)}; 1`);
      await sleep(1500);
      const start = Date.now();
      for (let last = '';;) {
        const ph = await evaluate('window.__rig?.phase ?? "boot"', 'boot');
        if (ph !== last) { last = ph; setPhase(ph === 'boot' ? 'rig-boot' : ph); }
        if (ph === 'done' || ph === 'error') break;
        if (Date.now() - start > 600_000) throw new Error('the rig did not finish in 600 s');
        await sleep(300);
      }
      await sleep(3000);
      result.rig = JSON.parse(await evaluate('JSON.stringify(window.__rig)', 'null'));
    }
    setPhase('done');
    await Promise.race([samplerDone, sleep(10_000)]);
  } catch (error) {
    result.error = String(error);
    say(`ERROR ${String(error)}`);
  } finally {
    if (phase !== 'done') setPhase('done');
    if (page) { await Promise.race([page.send('Memory.stopTracking').catch(() => null), sleep(2000)]); page.close(); }
    log.end();
    proxy.kill();
    sampler?.kill();
    const png = join(out, `${run.label}.png`);
    spawnSync('xcrun', ['simctl', 'io', udid, 'screenshot', png]);
    spawnSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '70', '-Z', '900', png, '--out', join(out, `${run.label}.jpg`)]);
    spawnSync('rm', ['-f', png]);
  }
  // per phase: the game tab's WebContent footprint (median, high), the GPU process, Web Inspector's total and categories
  const nf = join(out, `${run.label}.native.jsonl`);
  const rows = existsSync(nf) ? readFileSync(nf, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) : [];
  const phases = {};
  for (const ph of new Set(rows.filter((r) => r.type === 'sample').map((r) => r.phase))) {
    const rs = rows.filter((r) => r.type === 'sample' && r.phase === ph);
    const pidHigh = {};
    for (const r of rs) for (const [pid, [fp, iv]] of Object.entries(r.pids)) pidHigh[pid] = Math.max(pidHigh[pid] ?? 0, fp, iv);
    const game = Object.entries(pidHigh).sort((x, y) => y[1] - x[1])[0]?.[0];
    const is = samples.filter((s) => s.phase === ph);
    const cats = {};
    for (const s of is) for (const [k, v] of Object.entries(s.cats)) (cats[k] ??= []).push(v);
    phases[ph] = {
      webContentMB: game ? mb(median(rs.map((r) => r.pids[game]?.[0] ?? 0))) : null, webContentHighMB: game ? mb(pidHigh[game]) : null,
      gpuProcessMB: mb(median(rs.map((r) => r.gpu)) ?? 0),
      inspectorMB: is.length > 0 ? mb(median(is.map((s) => s.bytes))) : null, inspectorHighMB: is.length > 0 ? mb(Math.max(...is.map((s) => s.bytes))) : null,
      inspectorCatsMB: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, mb(median(v))])),
    };
  }
  result.phases = phases;
  return result;
}

async function drive(planFile) {
  const udid = process.env.SIM_UDID;
  if (!udid) throw new Error('--drive runs inside scripts/sim-lane.sh run (SIM_UDID)');
  const plan = JSON.parse(readFileSync(planFile, 'utf8'));
  await sleep(20_000); // a freshly booted device settles first
  const results = [];
  for (const run of plan.runs) {
    results.push(await oneRun(udid, run, plan.opts));
    writeFileSync(join(plan.opts.out, 'summary.json'), `${JSON.stringify({ tool: 'scripts/crossroads-rig/sim-probe.mjs', date: new Date().toISOString(), device: 'iOS Simulator, iPhone 17 Pro, Safari', base: plan.opts.base, results }, null, 1)}\n`);
  }
}

async function main() {
  const planFile = flag('plan', '');
  if (argv.includes('--drive')) { await drive(planFile); return; }
  const out = resolvePath(flag('out', ''));
  if (!flag('out', '')) throw new Error('--out=<dir> is required');
  mkdirSync(out, { recursive: true });
  const runs = [];
  for (const s of flags('shard')) runs.push({ kind: 'shard', slug: s, label: s });
  for (const r of flags('rig')) { const i = r.lastIndexOf('='); runs.push({ kind: 'rig', query: r.slice(0, i), label: `rig-${r.slice(i + 1)}` }); }
  const opts = { out, base: flag('base', 'http://127.0.0.1:4400/'), settle: Number(flag('settle', '15')), measure: Number(flag('measure', '15')) };
  writeFileSync(join(out, 'plan.json'), JSON.stringify({ opts, runs }, null, 1));
  const max = Number(flag('max', String(Math.ceil(runs.length * 4 + 4))));
  spawnSync('bash', [join(ROOT, 'scripts/sim-lane.sh'), 'run', '--max', String(max), DEVICE, process.execPath, join(ROOT, 'scripts/crossroads-rig/sim-probe.mjs'), '--drive', `--plan=${join(out, 'plan.json')}`], { stdio: 'inherit' });
  if (existsSync(join(out, 'summary.json'))) console.log(readFileSync(join(out, 'summary.json'), 'utf8').slice(0, 4000));
}

await main();
