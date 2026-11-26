#!/usr/bin/env node
// ZONE-ENTRY ZE21 (Jake, 2026-11-15 ~16:50 Cancún, on the 300 m home unload: "why would having the home cell on the road cause a
// memory issue, the road should be very cheap ... Having the home cell in memory when your 10m away 100m or 300m away shouldnt
// matter"): what fills the page on the road, item by item. From Driftwood by Shard Select, on the board out of its east entryway
// and north up the road, it reads at each stop: the allocator's cost model by owner and category (what `playingMB` and the
// envelope count), the owner ledger (`__wildshard.memory()`, GPU and RAM bytes by owner and kind), three.js's counts, the JS heap
// after a full GC, and the renderer and GPU process footprints (real bytes, macOS `phys_footprint`). Desktop Chromium, 60 fps.
//   src/scripts/browser-lane.sh node src/scripts/road-memory-probe.mjs --base=<loopback url> --out=<dir> [--label=<name>] [--stops=0,100,250,850]
// Stops are metres from the home's edge along the road (0: inside the home at control).
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { launchMemoryBrowser } from './chromium-memory-browser.mjs';
import { saveFixture } from './debug-settings.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';

const flag = (/** @type {string} */ name, /** @type {string} */ fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), label = flag('label', 'probe');
const stops = flag('stops', '0,100,250,850').split(',').map(Number);
if (!/^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: road-memory-probe.mjs --base=<loopback url> --out=<dir>');
mkdirSync(out, { recursive: true });
const MB = 1048576, HALF = 250, LANE_X = 281.25 - 10;
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
const FOOTPRINT = String.raw`
import ctypes, json, sys
class R(ctypes.Structure):
    _fields_ = [('uuid', ctypes.c_ubyte * 16)] + [(n, ctypes.c_uint64) for n in ('user_time','system_time','pkg_idle_wkups','interrupt_wkups','pageins','wired_size','resident_size','phys_footprint','proc_start_abstime','proc_exit_abstime')]
lib = ctypes.CDLL('/usr/lib/libproc.dylib'); out = {}
for p in sys.argv[1:]:
    u = R()
    out[p] = u.phys_footprint if lib.proc_pid_rusage(int(p), 0, ctypes.byref(u)) == 0 else None
print(json.dumps(out))
`;
const PAGE_READ = `(() => {
  const api = window.__wildshard, mem = (() => { try { return ${pageMemoryAttributionExpression}; } catch (e) { return { error: String(e) }; } })();
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); const v = m.get(k) ?? { bytes: 0, n: 0 }; v.bytes += r.bytes; v.n++; m.set(k, v); }
    return [...m.entries()].map(([k, v]) => ({ k, mb: Math.round(v.bytes / 1048576 * 10) / 10, n: v.n })).sort((a, b) => b.mb - a.mb).slice(0, 30); };
  const rows = Array.isArray(mem?.allocations) ? mem.allocations : [];
  const st = api.shard.grid.state();
  let three = null; try { const r = api.requireWorld().game.renderer; three = { textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length ?? null, calls: r.info.render.calls, triangles: r.info.render.triangles }; } catch {}
  // the cost model (what playingMB and the envelope count): every claim's accounted bytes by owner and by category, and the inputs
  let cost = null; try { const res = api.shard.grid.residency(), m = (b) => Math.round(b / 1048576 * 10) / 10, by = (key) => { const g = new Map(); for (const c of res.claims) { const k = key(c); g.set(k, (g.get(k) ?? 0) + (c.accountedBytes ?? 0)); } return [...g].map(([k, b]) => [k, m(b)]).sort((x, y) => y[1] - x[1]); };
    cost = { playingMB: m(res.cost.playing), accountedMB: m(res.cost.accounted), engineBaseMB: m(res.cost.input?.engineBase ?? 0), pageMB: m(res.cost.input?.page ?? 0), overlapMB: m(res.cost.input?.overlap ?? 0),
      byOwner: by(c => c.owner).slice(0, 20), byCategory: by(c => c.category), byOwnerCategory: by(c => c.owner + ' ' + c.category).slice(0, 30) }; } catch (e) { cost = { error: String(e).slice(0, 160) }; }
  const lv = st.live?.live;
  const why = { home: st.home, gate: st.gate, current: lv?.current ?? null, pending: lv?.pending ?? null, crossings: lv?.crossings ?? null, transitions: (lv?.transitions ?? []).slice(-6), retirements: (lv?.retirements ?? []).slice(-6), hybrid: st.runtimePage ?? null };
  return { why, cost, feet: st.feet, inside: st.inside, residents: st.live?.live?.residents ?? null, playingMB: st.playingMB, residentMB: st.residentMB, envelopeMB: st.envelopeMB,
    shows: Object.entries(st.cells.reduce((m, c) => { m[c.shows] = (m[c.shows] ?? 0) + 1; return m; }, {})), rings: { far: st.rings.far, l1: st.rings.l1, l0: st.rings.l0 },
    ledgerMB: mem?.totals ? { gpu: Math.round(mem.totals.gpu / 1048576), ram: Math.round(mem.totals.ram / 1048576) } : null,
    byOwner: group(rows, r => r.domain + ' ' + r.owner), byKind: group(rows, r => r.domain + ' ' + r.kind), three };
})()`;

const { browser, close } = await launchMemoryBrowser(['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--mute-audio']);
const result = { base, label, at: new Date().toISOString(), build: '', stops: /** @type {any[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '' };
let code = 1;
/** @type {import('playwright').Page | undefined} */
let shown;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const context = await browser.newContext({ viewport: { width: 2992, height: 1434 }, deviceScaleFactor: 2 }), page = await context.newPage(); shown = page;
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  const cdp = await browser.newBrowserCDPSession(), pageCdp = await context.newCDPSession(page);
  const footprint = async () => {
    const info = await cdp.send('SystemInfo.getProcessInfo'), pids = info.processInfo.filter(row => row.type === 'renderer' || row.type === 'GPU');
    const sizes = JSON.parse(spawnSync('python3', ['-c', FOOTPRINT, ...pids.map(row => String(row.id))], { encoding: 'utf8' }).stdout || '{}');
    const mb = (/** @type {string} */ type) => Math.round(pids.filter(row => row.type === type).reduce((sum, row) => sum + (sizes[String(row.id)] ?? 0), 0) / MB);
    return { rendererMB: mb('renderer'), gpuMB: mb('GPU') };
  };
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('roadmem'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  const origin = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const read = async (/** @type {string} */ name) => {
    await sleep(8000); // settle: rings, far views and lazy work reach a steady state at this spot
    const before = await footprint();
    await pageCdp.send('HeapProfiler.collectGarbage');
    const heapAfterGcMB = Math.round((await pageCdp.send('Runtime.getHeapUsage')).usedSize / MB);
    const row = { stop: name, ...await page.evaluate(PAGE_READ), process: before, processAfterGc: await footprint(), heapAfterGcMB };
    result.stops.push(row);
    console.log(`${name}: feet ${JSON.stringify(row.feet)} residents ${JSON.stringify(row.residents)} playingMB ${String(row.playingMB)} ledger ${JSON.stringify(row.ledgerMB)} heap ${String(heapAfterGcMB)} process ${JSON.stringify(row.processAfterGc)}`);
  };
  // drive by waypoints with W held; the page steers (a 50 ms yaw toward the next point)
  const drive = async (/** @type {{ x: number, z: number }[]} */ wps) => {
    await page.evaluate(points => {
      const W = /** @type {any} */ (window), q = W.__mem = { wps: points, at: 0 };
      if (W.__memTimer !== undefined) clearInterval(W.__memTimer);
      W.__memTimer = setInterval(() => { const wf = W.__wildshard.shard.grid.state().live?.live?.worldFeet, p = W.__wildshard.world.player, to = q.wps[q.at];
        if (wf === undefined || to === undefined) return; if (Math.hypot(wf.x - to.x, wf.z - to.z) < 4) { q.at++; return; } p.yaw = Math.atan2(wf.x - to.x, wf.z - to.z); }, 50);
    }, wps);
    await page.keyboard.down('KeyW');
    for (const ends = Date.now() + 180_000; Date.now() < ends;) { if (await page.evaluate(() => /** @type {any} */ (window).__mem.at >= /** @type {any} */ (window).__mem.wps.length)) break; await sleep(250); }
    await page.keyboard.up('KeyW');
  };
  for (const stop of stops) {
    if (stop === 0) { await read('home'); continue; }
    if (result.stops.every(row => row.stop === 'home')) {
      await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [HALF - 20, 0]);
      await sleep(3000);
      await page.evaluate(() => { const p = /** @type {any} */ (window).__wildshard.world.player; if (!p.hover) p.setHover(true); });
      await sleep(800);
      await drive([{ x: origin.x + LANE_X, z: origin.z }]);
    }
    // north along the road: the edge distance on the lane is hypot(lane offset, z past the corner); junctions are passed 10 m off
    // their centres (the lane already is)
    const z = HALF + Math.sqrt(Math.max(0, stop * stop - (LANE_X - HALF) ** 2));
    await drive([{ x: origin.x + LANE_X, z: origin.z + z }]);
    await read(`road+${String(stop)}m`);
  }
  await context.close();
  code = 0;
} catch (error) {
  result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`);
  await shown?.screenshot({ path: join(out, `${label}-fail.png`) }).catch(() => undefined);
}
finally {
  writeFileSync(join(out, `${label}-road-memory.json`), `${JSON.stringify(result, null, 2)}\n`);
  await close();
}
process.exit(code);
