#!/usr/bin/env node
// GRID-CROSSING GC3: every neighbouring pair of the grid, both ways, in one page. The page enters the grid on Driftwood's deck card,
// then tours the grid's border arcs (each pair once in each direction; the grid is the build's own catalogue `grid.cells`): for each
// arc the harness sets the walker 12 m inside the cell's edge on its entryway (probe.ts's harness pose, which only an in-page server
// hears: preview or a loopback page) and walks or boosts across by real input until it has control in the neighbour. Arcs toward +x
// or +z walk, arcs toward -x or -z boost, so every pair is crossed at both speeds once. A failed arc stays in its cell and the tour
// picks another; when a cell has no arc left it goes back over crossings that worked (scored too, marked `repeat`), and when none
// leads anywhere (a cell it can't leave) it enters again by the title.
// Per crossing, from the in-page samples (every 100 ms) and every frame: border to control, the longest run under 90 % of the
// approach speed (slow) and under 0.1 m per 100 ms with the key held (freeze), the time held at an unready neighbour (wall: phase
// preparing or blocked while frozen), the time the cell step screen shows, and frames over 33 and 50 ms within 3 s of the border.
// Not measured: grey stand-ins within 60 m (no reader yet).
//   scripts/browser-lane.sh node scripts/grid-crossing-tour.mjs --base=https://preview.wildshard.io --out=<dir> [--engine=chromium|webkit]
//     [--layout=phone] [--arcs=<from>:<to>,…] [--limit=<n crossings>] [--cold] [--lane=<name>] [--hold=<ms>] [--laps=<n>]
// --laps (GC14, the soak): cross every wanted arc, then again, n times; each row names its lap, with the memory at its control.
// --hold (GC13): after control, stand this long in the cell reached before the next crossing; each row then says when the cell left
// behind let its world go (`fromEvictedMs`) and the most the page's playing cost reached (`peakPlayingMB`).
// --cold (GC3's cold-cache pass): no HTTP cache and no service worker in any page, so every crossing fetches its cell from the
// network as a first visit does (Chromium: the DevTools cache switch; WebKit: service workers blocked only).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), phone = flag('layout', 'desktop') === 'phone';
// the harness pose is the in-page server's: preview or a loopback page only (never staging's or production's seats, J205)
if (!/^https:\/\/preview\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: grid-crossing-tour.mjs --base=<preview or loopback url> --out=<dir> [--engine=chromium|webkit] [--layout=phone] [--arcs=a:b,…] [--limit=n]');
if (engineName !== 'chromium' && engineName !== 'webkit') throw new Error(`No engine ${engineName}`);
const limit = Number(flag('limit', '400')), only = flag('arcs', '').split(',').filter(Boolean), cold = process.argv.includes('--cold'), lane = flag('lane', 'opus-gcm2'), hold = Number(flag('hold', '0')), laps = Number(flag('laps', '1'));
// --viewport=<w>x<h>@<dpr> (desktop): Jake's window is 2992x1434@2 (QA 11-14 row 6)
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '1440x900@1')) ?? [0, '1440', '900', '1']).slice(1).map(Number);
let currentLap = 1;
mkdirSync(out, { recursive: true });
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });

// the grid at the build the base serves (its version.json), not this checkout's
const build = await fetch(`${base}/version.json`, { signal: AbortSignal.timeout(15_000) }).then(async found => String((await found.json()).build).split('-')[0] ?? '').catch(() => '');
const catalogueText = (() => {
  try { return execFileSync('git', ['show', `${build}:src/shared/game/grid/singleplayer.json`], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { console.log(`build ${build} is not in this checkout: reading the working catalogue`); return readFileSync(join(import.meta.dirname, '../src/shared/game/grid/singleplayer.json'), 'utf8'); }
})();
/** @type {{ instance: string, slug: string, cell: [number, number] }[]} */
const cells = JSON.parse(catalogueText).grid.cells;
const at = new Map(cells.map(cell => [cell.cell.join(','), cell]));
/** @typedef {{ from: string, to: string, dx: number, dz: number, boost: boolean }} Arc */
/** @type {Arc[]} */
const arcs = [];
for (const cell of cells) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
  const next = at.get(`${String(cell.cell[0] + dx)},${String(cell.cell[1] + dz)}`);
  if (next !== undefined) arcs.push({ from: cell.instance, to: next.instance, dx, dz, boost: dx + dz < 0 });
}
const wanted = only.length === 0 ? arcs : arcs.filter(arc => only.includes(`${arc.from}:${arc.to}`));
// --in=<m>: how far inside its cell's edge each walk starts (default 12 m), so a walk from deeper in measures the pre-warm (GC6)
const HOME = 'driftwood-isle', HOME_CARD = 'Driftwood Isle', EDGE_IN = 250 - Number(flag('in', '12')), LEG_MS = 90_000, STUCK_MS = 1500;

/** @type {Record<string, unknown>[]} */
const crossings = [];
const result = { lane, base, build, cold, engine: engineName, layout: phone ? 'phone 402x874 touch' : `desktop ${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, at: new Date().toISOString(), arcs: wanted.length, crossings, errors: /** @type {string[]} */ ([]), console: /** @type {string[]} */ ([]), reloads: 0, reentries: 0, lostPage: /** @type {Record<string, unknown>[]} */ ([]), note: '', untried: /** @type {string[]} */ ([]) };
const save = () => writeFileSync(join(out, `${engineName}-${phone ? 'phone' : 'desktop'}-tour.json`), `${JSON.stringify(result, null, 2)}\n`);
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : [] });
let code = 1;
try {
  // a fresh profile at each entry: the first, and again when the tour is stranded in a cell it can't leave (a grid page's title
  // won't take a second Shard Select in the same profile)
  /** @type {import('playwright').BrowserContext | null} */ let context = null;
  /** @type {import('playwright').Page} */ let page = /** @type {any} */ (undefined);
  let navigations = 0;
  const profile = async () => {
    await context?.close();
    context = await browser.newContext(phone ? { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: engineName === 'chromium', hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1', ...cold ? { serviceWorkers: 'block' } : {} }
      : { viewport: { width: desk[0], height: desk[1] }, deviceScaleFactor: desk[2], ...cold ? { serviceWorkers: 'block' } : {} });
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: phone ? { tier: 'phone', volume: 0 } : { volume: 0 } });
    page = await context.newPage();
    if (cold && engineName === 'chromium') await (await context.newCDPSession(page)).send('Network.setCacheDisabled', { cacheDisabled: true });
    const opened = page;
    page.on('pageerror', error => { if (result.errors.length < 20) result.errors.push(error.message.slice(0, 240)); });
    // GC6: the page's own warnings name a stuck entry preparation (`[grid] <cell>: entry preparation on the road`)
    page.on('console', message => { if ((message.type() === 'warning' || message.type() === 'error') && result.console.length < 60) result.console.push(`${message.type()} ${message.text().slice(0, 300)}`); });
    page.on('framenavigated', frame => { if (frame === opened.mainFrame()) navigations++; });
  };
  /** Into the grid by Driftwood's deck card, and the sampler on: at the start, and again when the tour is stranded in a cell it can't leave. */
  const enter = async () => {
    await profile();
    await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
    await page.locator('.ws-main-select').click({ timeout: 120_000 });
    if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('walker'); await page.locator('#ws-name-box button[type=submit]').click(); }
    await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
    const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), HOME_CARD);
    if (index < 0) throw new Error(`No ${HOME_CARD} card`);
    await page.locator('.ws-menu-dots i').nth(index).click();
    await page.locator('.ws-menu-play').click();
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
    await sleep(2000);
    await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
    await page.evaluate(() => {
      const W = /** @type {any} */ (window), q = W.__gc3 = { frames: /** @type {number[][]} */ ([]), samples: /** @type {any[]} */ ([]), longTasks: /** @type {number[][]} */ ([]), sentinel: 1, target: /** @type {string | undefined} */ (undefined) }, t0 = performance.now();
      try { performance.setResourceTimingBufferSize(100_000); } catch { /* the default 250 entries */ }
      // GC8: main-thread long tasks (Chromium only; WebKit has no longtask entries), as [start, duration] on the page clock
      try { new PerformanceObserver(list => { for (const entry of list.getEntries()) { q.longTasks.push([Math.round(entry.startTime), Math.round(entry.duration)]); if (q.longTasks.length > 20_000) q.longTasks.splice(0, 10_000); } }).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask entries */ }
      let last = t0;
      const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now - t0), Number((now - last).toFixed(1))]); last = now; if (q.frames.length > 60_000) q.frames.splice(0, 30_000); requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      setInterval(() => { try {
        const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, lv = st.live;
        q.samples.push({ t: Math.round(performance.now() - t0), x: Number(p.position.x.toFixed(2)), y: Number(p.position.y.toFixed(2)), z: Number(p.position.z.toFixed(2)), inside: st.inside,
          phase: lv?.crossing?.phase, ready: lv?.live?.gameplayReady, loading: st.cellLoading, step: st.cellStep?.step ?? null,
          // GC6: whether the crossing's target world (colliders and sim) is resident yet, and the world built ahead (GC5)
          built: q.target === undefined ? null : lv?.live?.residents?.includes(q.target) === true, ahead: lv?.live?.ahead?.instance ?? null, refused: lv?.live?.ahead?.refused ?? null, deferred: lv?.live?.ahead?.deferred ?? null, env: st.envelopeMB ?? null, pending: lv?.live?.pending ?? null,
          // GC13: the cells whose worlds the page holds, and what playing costs
          res: lv?.live?.residents ?? null, mb: st.playingMB ?? null,
          // GC12: how many closed walls show (only the ones the walker stands at)
          wall: st.softWalls?.shown ?? null });
        if (q.samples.length > 20_000) q.samples.splice(0, 10_000);
      } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 100);
    });
    await sleep(500);
  };
  await enter();
  let navigationsBefore = navigations, lastWindowEnd = 0;
  /** @returns {Promise<any>} */
  const sample = () => page.evaluate(() => { const rows = /** @type {any[]} */ (/** @type {any} */ (window).__gc3.samples); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].err === undefined) return rows[i]; return undefined; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted_ => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted_; }, yaw);

  /** One crossing over `arc` from where the walker stands (in `arc.from`). @param {Arc} arc @param {boolean} repeat */
  const cross = async (arc, repeat) => {
    const row = /** @type {Record<string, any>} */ ({ from: arc.from, to: arc.to, boost: arc.boost, repeat, lap: currentLap, ok: false, why: '' });
    crossings.push(row);
    // GC8: the target's preparation work since the last crossing ended (a pre-warm starts inside the source, GC5)
    const windowStart = lastWindowEnd;
    await page.evaluate(target => { /** @type {any} */ (window).__gc3.target = target; }, arc.to);
    const yaw = Math.atan2(-arc.dx, -arc.dz);
    // the harness pose: probe.ts `told`, so the in-page server hears where the walker stands
    const place = async (/** @type {number} */ inset) => {
      const px = arc.dx * inset, pz = arc.dz * inset;
      await page.evaluate(([x, z, y]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(x, z, y, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, y); }, [px, pz, yaw]);
      await sleep(3000);
      const at_ = await sample();
      return { at_, ok: at_.inside === arc.from && Math.hypot(at_.x - px, at_.z - pz) <= 4 };
    };
    const { at_: placed, ok: placedOk } = await place(EDGE_IN);
    row.placed = { x: placed.x, y: placed.y, z: placed.z, inside: placed.inside };
    if (!placedOk) { row.why = `not placed on ${arc.from}'s entryway (inside ${String(placed.inside)})`; return row; }
    await face(yaw);
    const t1 = Date.now(), tFrom = (await sample()).t;
    await page.keyboard.down('KeyW'); if (arc.boost) await page.keyboard.down('ShiftLeft');
    let controlAt = 0, controlT = 0, jumps = 0, stuckSince = 0, last = placed, fell = false;
    while (Date.now() - t1 < LEG_MS) {
      await sleep(250);
      const s = await sample();
      if (s === undefined) continue;
      const moved = Math.hypot(s.x - last.x, s.z - last.z), now = Date.now() - t1;
      if (controlAt === 0) {
        if (moved < 0.15) stuckSince ||= now; else stuckSince = 0;
        if (stuckSince !== 0 && now - stuckSince > STUCK_MS && jumps < 4 && s.phase !== 'preparing') { await page.keyboard.press('Space'); jumps++; stuckSince = now; }
        if (s.inside === arc.from && s.y < placed.y - 8) { fell = true; break; }
        if (s.inside === arc.to && s.ready === true && (s.phase === undefined || s.phase === 'settled') && moved > 0.3) {
          controlAt = now; controlT = s.t;
          // GC14: the page's memory at each control, so the tour doubles as the long-walk soak
          row.memory = await page.evaluate(() => { const W = /** @type {any} */ (window); let st = null; try { st = W.__wildshard.shard.grid.state(); } catch { /* no grid yet */ }
            const perf = /** @type {any} */ (performance); return { playingMB: st?.playingMB ?? null, residentMB: st?.residentMB ?? null, heapMB: perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null }; }).catch(() => null);
        }
      } else if (now - controlAt > 2500) break;
      last = s;
      if (jumps >= 4 && stuckSince !== 0 && now - stuckSince > 10_000) break;
    }
    await page.keyboard.up('KeyW'); if (arc.boost) await page.keyboard.up('ShiftLeft');
    // GC13 `--hold`: stand in the cell reached, so the page can let the cell behind go
    await sleep(controlAt === 0 ? 400 : Math.max(400, hold));
    const rows =/** @type {any[]} */ (await page.evaluate(t => /** @type {any} */ (window).__gc3.samples.filter((/** @type {any} */ r) => r.err === undefined && r.t >= t), tFrom));
    const frames = /** @type {number[][]} */ (await page.evaluate(t => /** @type {any} */ (window).__gc3.frames.filter((/** @type {number[]} */ f) => (f[0] ?? 0) >= t), tFrom));
    const entered = rows.find(r => r.inside === arc.to), roadAt = rows.find(r => r.inside === null);
    /** longest run of consecutive samples (each ~100 ms) matching `test`, in ms, before control */
    const untilT = controlAt === 0 ? Infinity : controlT;
    const speeds = rows.slice(1).map((r, i) => { const p = rows[i]; return { t: r.t, v: Math.hypot(r.x - p.x, r.z - p.z) / Math.max(0.05, (r.t - p.t) / 1000), r }; });
    const head = speeds.slice(2, 22).map(s => s.v).sort((a, b) => a - b), approach = head[Math.floor(head.length / 2)] ?? 0;
    const longest = (/** @type {(s: { t: number, v: number, r: any }) => boolean} */ test) => { let best = 0, since = -1; for (const s of speeds) { if (s.t > untilT) break; if (test(s)) { if (since < 0) since = s.t; best = Math.max(best, s.t - since + 100); } else since = -1; } return best; };
    const sum = (/** @type {(s: { t: number, v: number, r: any }) => boolean} */ test) => speeds.filter(s => s.t <= untilT && test(s)).length * 100;
    // GC6: how long before the border the target's world stood built (negative: built only after the feet crossed)
    const builtAt = rows.find(r => r.built === true)?.t;
    row.builtBeforeBorderMs = builtAt === undefined || entered === undefined ? null : entered.t - builtAt;
    row.prewarmed = rows.some(r => r.ahead === arc.to && r.inside === arc.from);
    // GC13: how long after control the cell left behind still held its world (null: still held when the window ended), and the most
    // the page's playing cost reached in the window
    const evicted = controlAt === 0 ? undefined : rows.find(r => r.t >= controlT && Array.isArray(r.res) && !r.res.includes(arc.from));
    row.fromEvictedMs = evicted === undefined ? null : evicted.t - controlT;
    row.peakPlayingMB = Math.max(0, ...rows.map(r => (typeof r.mb === 'number' ? r.mb : 0)));
    // GC12: how long a hex wall showed in this crossing (samples every 100 ms); only a cold crossing held at the edge should show one
    row.wallShownMs = rows.filter(r => typeof r.wall === 'number' && r.wall > 0).length * 100;
    const border = entered?.t ?? Infinity, near = frames.filter(f => Math.abs((f[0] ?? 0) - border) <= 3000).map(f => f[1] ?? 0);
    Object.assign(row, { ok: controlAt !== 0, why: controlAt !== 0 ? '' : fell ? `fell off ${arc.from}'s entryway (no ground there)` : entered === undefined ? (roadAt === undefined ? `never left ${arc.from}` : `held on the road (${String(last.phase)})`) : 'in the cell, no control',
      borderToControlMs: entered === undefined || controlAt === 0 ? null : controlT - entered.t, controlMs: controlAt === 0 ? null : controlAt, approachMps: Number(approach.toFixed(2)),
      slowMs: approach > 0 ? longest(s => s.v < approach * 0.9) : null, freezeMs: longest(s => s.v * 0.1 < 0.1), wallMs: sum(s => (s.r.phase === 'preparing' || s.r.phase === 'blocked') && s.v * 0.1 < 0.1),
      stepScreenMs: sum(s => s.r.loading !== null && s.r.loading !== undefined && s.r.loading !== false), over33: near.filter(ms => ms > 33).length, over50: near.filter(ms => ms > 50).length,
      // GC8: how long each `cell` step stood on the loading screen in this crossing (samples every 100 ms; a build before GC8 reads none)
      steps: speeds.reduce((/** @type {Record<string, number>} */ onScreen, x) => { if (x.t <= untilT && typeof x.r.step === 'string' && x.r.step !== '') onScreen[x.r.step] = (onScreen[x.r.step] ?? 0) + 100; return onScreen; }, {}),
      worstFrameMs: Math.max(0, ...near), jumps, lowestY: Math.min(...rows.map(r => r.y)), end: { inside: last.inside, x: last.x, y: last.y, z: last.z, phase: last.phase } });
    // GC6: each crossing keeps its samples (every 500 ms), so its cause can be read from the json
    row.trace = rows.filter((_, i) => i % 5 === 0).map(r => ({ t: r.t - tFrom, x: r.x, z: r.z, inside: r.inside, phase: r.phase, ready: r.ready, step: r.step, built: r.built, ahead: r.ahead, refused: r.refused, deferred: r.deferred, mb: r.mb, env: r.env, pending: r.pending, res: r.res }));
    // a failed crossing held on the road boosts back into the cell it left, so the tour goes on from there
    if (!row.ok && last.inside !== arc.from && last.inside !== arc.to) {
      await face(yaw + Math.PI); await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
      for (const ends = Date.now() + 30_000; Date.now() < ends && (await sample())?.inside !== arc.from;) await sleep(250);
      await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft'); await sleep(1500);
      row.backIn = (await sample())?.inside === arc.from;
    }
    // GC8: what preparing the target cost in this window: its `wildshard.prepare:<slug>:<step>` spans (wall ms, developer pages
    // only), the main thread's long tasks, and the bytes fetched under its shardfile folder (resource timing transfer sizes)
    const slug = cells.find(cell => cell.instance === arc.to)?.slug ?? arc.to;
    Object.assign(row, await page.evaluate(([from, name]) => {
      const W = /** @type {any} */ (window), end = performance.now();
      const spans = performance.getEntriesByType('measure').filter(entry => entry.name.startsWith(`wildshard.prepare:${name}:`) && entry.startTime >= from)
        .map(entry => [entry.name.slice(`wildshard.prepare:${name}:`.length), Math.round(entry.startTime - from), Math.round(entry.duration)]);
      const tasks = /** @type {number[][]} */ (W.__gc3.longTasks ?? []).filter(task => (task[0] ?? 0) >= from && (task[0] ?? 0) <= end);
      const files = /** @type {PerformanceResourceTiming[]} */ (performance.getEntriesByType('resource')).filter(entry => entry.startTime >= from && entry.name.includes(`/${name}/`));
      return { prepare: { windowMs: Math.round(end - from), spans: spans.slice(0, 200), longTasks: tasks.length, longTaskMs: tasks.reduce((total, task) => total + (task[1] ?? 0), 0),
        files: files.length, bytes: files.reduce((total, entry) => total + (entry.transferSize || 0), 0), decodedBytes: files.reduce((total, entry) => total + (entry.decodedBodySize || 0), 0) }, windowEnd: end };
    }, /** @type {[number, string]} */ ([windowStart, slug])).then(({ prepare, windowEnd }) => { lastWindowEnd = windowEnd; return { prepare }; }).catch(() => ({})));
    if (!row.ok || row.wallMs > 0) await page.screenshot({ path: join(out, `${engineName}-${arc.from}-${arc.to}.png`) }).catch(() => undefined);
    console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${arc.from} -> ${arc.to}${arc.boost ? ' boost' : ''}${repeat ? ' (repeat)' : ''} ${JSON.stringify({ why: row.why, b2c: row.borderToControlMs, wall: row.wallMs, freeze: row.freezeMs, over50: row.over50 })}`);
    return row;
  };

  // the tour: from the cell the walker is in, the arc not yet crossed whose target has the most arcs left; else back over a crossed arc
  let here = (await sample()).inside ?? HOME;
  const left = new Set(wanted), good = /** @type {Arc[]} */ ([]);
  for (let lap = 1; ; ) {
    // GC14 `--laps`: once every arc is crossed, go round them all again (the soak), each row naming its lap
    if (left.size === 0 && lap < laps && good.length > 0) { lap++; currentLap = lap; for (const arc of wanted) left.add(arc); }
    if (left.size === 0 || crossings.length >= limit) break;
    if (navigations !== navigationsBefore) { result.note = 'the page reloaded: tour stopped'; break; }
    if (result.lostPage.length > 4) { result.note = 'the page was lost a fifth time: tour stopped'; break; }
    const outs = [...left].filter(arc => arc.from === here);
    let arc = outs.sort((a, b) => [...left].filter(o => o.from === b.to).length - [...left].filter(o => o.from === a.to).length)[0], repeat = false;
    if (arc === undefined) {
      // the shortest way over crossed arcs to a cell with arcs left
      /** @type {Map<string, { from: string, to: string, dx: number, dz: number, boost: boolean } | null>} */ const via = new Map([[here, null]]); const queue = [here]; let goal = '';
      while (queue.length > 0 && goal === '') { const cell = /** @type {string} */ (queue.shift()); for (const g of good.filter(o => o.from === cell && !via.has(o.to))) { via.set(g.to, g); queue.push(g.to); if ([...left].some(o => o.from === g.to)) { goal = g.to; break; } } }
      if (goal === '') {
        // stranded (a cell whose every way out failed, Far Reach's sky islands): back in by the title; the arcs out of here count as tried
        for (const o of [...left].filter(row => row.from === here)) { left.delete(o); crossings.push({ from: o.from, to: o.to, boost: o.boost, repeat: false, ok: false, why: `not tried: stranded in ${here}` }); }
        if (result.reentries >= 4) { result.note = `stranded in ${here} a fifth time: stopped`; break; }
        // re-entry lands on HOME: stop when no arc left starts anywhere HOME's good arcs reach (one failure out of HOME otherwise re-enters four times for nothing)
        const reach = new Set([HOME]); for (let grew = true; grew;) { grew = false; for (const g of good) if (reach.has(g.from) && !reach.has(g.to)) { reach.add(g.to); grew = true; } }
        if (![...left].some(o => reach.has(o.from))) { result.note = `stranded in ${here}, and no arc left is reachable from ${HOME}: stopped`; break; }
        result.reentries++; await enter(); navigationsBefore = navigations; lastWindowEnd = 0; here = (await sample())?.inside ?? HOME; continue;
      }
      let step = goal; while (via.get(step)?.from !== here) step = /** @type {Arc} */ (via.get(step)).from;
      arc = /** @type {Arc} */ (via.get(step)); repeat = true;
    }
    left.delete(arc);
    /** @type {Record<string, any>} */ let row;
    try { row = await cross(arc, repeat); }
    catch (error) {
      // the tour's probe (window.__gc3) went with the document: the page navigated or reloaded under the crossing. Record what the
      // game says about it (its own navigations write a reason first: lastEnd.ts `markReload` / `markUnload`), then enter again.
      const lost = await page.evaluate(() => { const life = /** @type {Record<string, string>} */ ({}); for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i) ?? ''; if (/life\.|selfReload/u.test(key)) life[key] = (localStorage.getItem(key) ?? '').slice(0, 400); }
        return { probe: /** @type {any} */ (window).__gc3 !== undefined, url: location.href, life }; }).catch((/** @type {unknown} */ cause) => ({ probe: false, url: '', life: {}, unreadable: String(cause).slice(0, 200) }));
      if (lost.probe) throw error;
      const last = crossings.at(-1); if (last !== undefined && last.from === arc.from && last.to === arc.to) { last.ok = false; last.why = 'the page lost the tour probe (navigated or reloaded)'; }
      result.lostPage.push({ arc: `${arc.from}:${arc.to}`, navigations: navigations - navigationsBefore, error: String(error).slice(0, 200), ...lost });
      console.log(`LOST ${arc.from} -> ${arc.to}: ${JSON.stringify(lost).slice(0, 400)}`);
      save(); result.reentries++; await enter(); navigationsBefore = navigations; lastWindowEnd = 0; here = (await sample())?.inside ?? HOME; continue;
    }
    save(); // after every crossing, so a run cut off by its timeout keeps what it measured
    if (row.ok) { if (!repeat) good.push(arc); here = arc.to; } else { here = (await sample()).inside ?? here; if (repeat) good.splice(good.indexOf(arc), 1); }
  }
  result.reloads = navigations - navigationsBefore;
  if (left.size > 0) result.untried = [...left].map(arc => `${arc.from}:${arc.to}`);
  code = crossings.length > 0 && crossings.every(row => row.ok) && result.reloads === 0 ? 0 : 1;
  await /** @type {import('playwright').BrowserContext | null} */ (/** @type {unknown} */ (context))?.close();
} catch (error) { result.note = `the run: ${String(error).slice(0, 400)}`; }
finally {
  save();
  await browser.close();
}
console.log(`grid-crossing tour: ${String(crossings.filter(row => row.ok).length)} of ${String(crossings.length)} crossings reached control; ${out}`);
process.exit(code);
