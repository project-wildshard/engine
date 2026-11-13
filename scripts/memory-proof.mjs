#!/usr/bin/env node
// IOSMEM (meta PAGE-SIZE-PLAN): the iPhone page-memory proof for Driftwood Isle, after WILDSHARD-GAME-8G (Jake 2026-11-13:
// staging v0.1.16 restarted while Playing on Driftwood on his iPhone 17 Pro, the page killed for memory). One command reads
// the page's memory at boot (title), in Playing on Driftwood, and at Driftwood's west edge where Sunscar's cell prepares:
// the owner ledger (`__wildshard.memory()`, GPU and RAM bytes by owner and kind), three.js's counts, the texture form this
// device loads, the grid's resident cells and claims, the JS heap (Chromium) and, on Chromium, the renderer and GPU
// process footprints. Phone tier, iPhone 17 Pro viewport (402x874, 3x pixel density), headless.
//   scripts/browser-lane.sh node scripts/memory-proof.mjs --base=<staging or loopback url> [--engine=chromium|webkit]
//     [--out=tmp/<lane>/memory-proof] [--label=<name>] [--edge=0] [--budget-mb=<n>]
// --budget-mb fails the run (exit 1) when the ledger's GPU+RAM peak passes n MB: the gate a later lane can hold.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { pageMemoryAttributionExpression } from './memory-report-snapshot.mjs';

/** @type {Record<string, string>} */
const args = Object.fromEntries(process.argv.slice(2).map(arg => /^--([^=]+)(?:=(.*))?$/u.exec(arg)).filter(match => match !== null).map(match => [match[1], match.at(2) ?? '1']));
const base = (args.base ?? '').replace(/\/$/u, '');
if (!/^https:\/\/(staging|preview)\.wildshard\.io$|^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(base)) throw new Error('--base takes staging, preview or a loopback page: never production (J205)');
const engineName = args.engine ?? 'chromium';
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error(`No engine ${engineName}`);
const label = args.label ?? `${engineName}-${new URL(base).host.replaceAll(/[^a-z0-9]+/giu, '-')}`;
const out = absolute(args.out ?? 'tmp/memory-proof');
const budgetMB = args['budget-mb'] === undefined ? null : Number(args['budget-mb']);
const edge = args.edge !== '0';
mkdirSync(out, { recursive: true });
const MB = 1048576;
/** @param {number} ms */
const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });

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

/** In-page reader: plain data only, never a resource getter that could rebuild a retired resource. */
const PAGE_READ = `(() => {
  const api = window.__wildshard, mem = (() => { try { return ${pageMemoryAttributionExpression}; } catch (e) { return { error: String(e) }; } })();
  const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); const v = m.get(k) ?? { bytes: 0, n: 0 }; v.bytes += r.bytes; v.n++; m.set(k, v); }
    return [...m.entries()].map(([k, v]) => ({ k, mb: Math.round(v.bytes / 1048576 * 10) / 10, n: v.n })).sort((a, b) => b.mb - a.mb).slice(0, 25); };
  const rows = Array.isArray(mem?.allocations) ? mem.allocations : [];
  let grid = null; try { const g = api?.shard?.grid; if (g) { const st = g.state(), res = g.residency?.();
    grid = { inside: st.inside, home: st.home, feet: st.feet, residentMB: st.residentMB, playingMB: st.playingMB, strips: st.strips,
      cells: st.cells.map(c => ({ slug: c.slug, cell: c.cell, shows: c.shows, drawn: c.drawn })), rings: { far: st.rings.far, l1: st.rings.l1, l0: st.rings.l0, inFlight: st.rings.inFlight, queued: st.rings.queued },
      near: st.near, claims: res ? res.claims.map(c => ({ id: c.id ?? c.instance ?? c.key, bytes: c.bytes, kind: c.kind ?? c.category })) : null, cost: res?.cost ?? null }; } } catch (e) { grid = { error: String(e).slice(0, 200) }; }
  let three = null; try { const r = api.requireWorld().game.renderer; three = { textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs?.length ?? null, pixelRatio: r.getPixelRatio() }; } catch {}
  let textures = null; try { const t = api.textures?.(); textures = t ? { mode: t.mode, why: t.why, families: t.probe?.families ?? null } : null; } catch (e) { textures = { error: String(e).slice(0, 120) }; }
  let audio = null; try { audio = api.requireWorld().audio.census(); } catch {}
  return { href: location.href, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    totalsMB: mem?.totals ? { gpu: Math.round(mem.totals.gpu / 1048576), ram: Math.round(mem.totals.ram / 1048576) } : null,
    unattributedMB: mem?.unattributed ? { gpu: Math.round(mem.unattributed.gpu / 1048576), ram: Math.round(mem.unattributed.ram / 1048576) } : null,
    byOwner: group(rows, r => r.domain + ' ' + r.owner), byKind: group(rows, r => r.domain + ' ' + r.kind), byAsset: group(rows, r => r.domain + ' ' + r.owner + ' ' + r.asset),
    // PZ22: each texture of 1 MB or more, whole, so a texture form change is read per texture, not only in the total
    texRows: rows.filter(r => r.domain === 'gpu' && r.kind === 'texture' && r.bytes >= 1048576).sort((a, b) => b.bytes - a.bytes).slice(0, 40).map(r => JSON.parse(JSON.stringify(r))),
    three, textures, grid, audio };
})()`;

/** @type {Record<string, unknown>} */
const result = { lane: 'opus-iosmem', engine: engineName, base, label, at: new Date().toISOString(), phases: [], errors: [] };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true,
  args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : [] });
let code = 0;
try {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: engineName === 'chromium', hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1' });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0 } });
  await context.route('**/api/errors', route => route.fulfill({ status: 204, body: '' }));
  const page = await context.newPage(); page.setDefaultTimeout(240_000);
  page.on('pageerror', error => { /** @type {string[]} */ (result.errors).push(error.message.slice(0, 240)); });
  const cdp = engineName === 'chromium' ? await browser.newBrowserCDPSession() : null;
  const pageCdp = engineName === 'chromium' ? await context.newCDPSession(page) : null;
  const heapProfile = args['heap-profile'] !== undefined && pageCdp !== null;
  /** Chromium only: the live JS heap after a full collection, so garbage awaiting GC is told apart from what is held. */
  const heapAfterGc = async () => { if (pageCdp === null) return null; await pageCdp.send('HeapProfiler.collectGarbage'); return Math.round((await pageCdp.send('Runtime.getHeapUsage')).usedSize / MB); };
  const footprint = async () => {
    if (cdp === null) return null;
    const info = await cdp.send('SystemInfo.getProcessInfo'), pids = info.processInfo.filter(row => row.type === 'renderer' || row.type === 'GPU');
    const sizes = JSON.parse(spawnSync('python3', ['-c', FOOTPRINT, ...pids.map(row => String(row.id))], { encoding: 'utf8' }).stdout || '{}');
    const mb = (/** @type {string} */ type) => Math.round(pids.filter(row => row.type === type).reduce((sum, row) => sum + (sizes[String(row.id)] ?? 0), 0) / MB);
    return { rendererMB: mb('renderer'), gpuMB: mb('GPU') };
  };
  const phase = async (/** @type {string} */ name) => {
    const row = { phase: name, ...await page.evaluate(PAGE_READ), process: await footprint(), heapAfterGcMB: await heapAfterGc() };
    row.processAfterGc = pageCdp === null ? null : await footprint();
    /** @type {unknown[]} */ (result.phases).push(row);
    await page.screenshot({ path: join(out, `${label}-${name}.jpg`), type: 'jpeg', quality: 60 }).catch(() => undefined);
    const t = row.totalsMB;
    console.log(`${name}: ledger gpu ${t?.gpu ?? '?'} MB ram ${t?.ram ?? '?'} MB, heap ${row.heapMB ?? '-'} MB (after GC ${row.heapAfterGcMB ?? '-'}), process ${JSON.stringify(row.process)}, three ${JSON.stringify(row.three)}, tex ${row.textures?.mode ?? '?'}, cells ${row.grid?.cells?.map((/** @type {any} */ c) => `${c.slug}:${JSON.stringify(c.shows)}`).join(' ') ?? '-'}`);
    for (const top of row.byOwner.slice(0, 8)) console.log(`   ${top.k} ${top.mb} MB (${top.n})`);
    return row;
  };
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 120_000 });
  await sleep(3000);
  await phase('boot');
  await page.locator('.ws-main-select').click();
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 15_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('memproof'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(() => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes('Driftwood Isle')));
  if (index < 0) throw new Error('No Driftwood Isle card');
  await page.locator('.ws-menu-dots i').nth(index).click();
  if (heapProfile) { await pageCdp.send('HeapProfiler.enable'); await pageCdp.send('HeapProfiler.startSampling', { samplingInterval: 65536, includeObjectsCollectedByMajorGC: args['heap-profile'] === 'alloc', includeObjectsCollectedByMinorGC: args['heap-profile'] === 'alloc' }); }
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 240_000, polling: 250 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  await sleep(10_000);
  await phase('playing');
  // 40 s more without moving: a page that keeps growing while the player stands still is the leak, not the walk.
  /** @type {unknown[]} */ const still = []; result.still = still;
  for (let i = 0; i < 4; i++) { await sleep(10_000); const at = await page.evaluate(() => ({ heapMB: (() => { const memory = /** @type {any} */ (performance).memory; return memory ? Math.round(memory.usedJSHeapSize / 1048576) : null; })(), loading: /** @type {any} */ (window).__wildshard.shard.grid.state().cells.filter((/** @type {any} */ c) => c.shows === 'loading').length })); still.push({ s: (i + 1) * 10, ...at, process: await footprint() }); console.log(`still +${(i + 1) * 10}s ${JSON.stringify(still.at(-1))}`); }
  await phase('still');
  if (heapProfile) {
    const { profile } = await pageCdp.send('HeapProfiler.stopSampling');
    /** @type {Map<string, number>} */ const self = new Map(), total = new Map();
    const walk = (/** @type {any} */ node, /** @type {string[]} */ stack) => {
      const f = node.callFrame, key = `${f.functionName === '' ? '(anon)' : f.functionName} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + node.selfSize);
      const next = [...stack, key]; for (const k of new Set(next)) total.set(k, (total.get(k) ?? 0) + node.selfSize);
      for (const child of node.children) walk(child, next);
    };
    walk(profile.head, []);
    const top = (/** @type {Map<string, number>} */ m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, b]) => ({ k, mb: Math.round(b / MB * 10) / 10 }));
    result.heapSelf = top(self); result.heapTotal = top(total);
    console.log('heap self (live sampled):'); for (const row of /** @type {any[]} */ (result.heapSelf).slice(0, 25)) console.log(`   ${row.mb} MB ${row.k}`);
  }
  if (edge) {
    // Driftwood's west entryway toward Sunscar (grid-crossing-walk-proof's approach), placed by the harness pose, then 20 s for the neighbour to prepare.
    for (const [x, z] of [[-235, -194], [-235, 0], [-245, 0]]) {
      // the online page's server owns the position: place tells it (probe.ts `told`)
      await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, Math.max(p.position.y, 0.5)); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [x, z]);
      await sleep(4000);
    }
    await sleep(16_000);
    await phase('edge');
  }
  const peak = Math.max(...(/** @type {any[]} */ (result.phases)).map(row => (row.totalsMB?.gpu ?? 0) + (row.totalsMB?.ram ?? 0)));
  result.peakLedgerMB = peak;
  if (budgetMB !== null && peak > budgetMB) { code = 1; console.log(`FAIL ledger peak ${peak} MB > budget ${budgetMB} MB`); }
  await context.close();
} catch (error) { code = 1; /** @type {string[]} */ (result.errors).push(String(error).slice(0, 400)); console.log(`FAIL ${String(error).slice(0, 400)}`); }
finally {
  writeFileSync(join(out, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(`memory proof ${label}: ${code === 0 ? 'done' : 'FAIL'} → ${join(out, `${label}.json`)}`);
process.exit(code);
