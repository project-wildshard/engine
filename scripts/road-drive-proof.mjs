#!/usr/bin/env node
// ZONE-ENTRY ZE3 (Jake, 2026-11-15: "drive around on the road absolutely everywhere, pass all kinds of cells, and then come
// back. Come back to the one"): from a home cell entered by Shard Select, step out of its east entryway by real input and drive
// the whole road with the run key held: every segment of the grid's junction lattice (every row, then every column, the outer
// ring included), past every other cell, then back to the home's east entryway and into the home. Per segment it reads the road
// bar (meta docs/plans/ZONE-ENTRY-PLAN.md): every frame's time, the longest stretch under 90 % of the segment's own speed with
// the key held, any loading card on screen, `playingMB`, and whether the home stayed resident; then the walk back in.
//   scripts/browser-lane.sh node scripts/road-drive-proof.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood]
//     [--engine=chromium|webkit] [--device='iPhone 15 Pro'] [--viewport=2992x1434@2] [--segments=n] (the first n only, a short check)
//     [--ride=board|boost|run] (default board: the hoverboard, 30 m/s on the road, J354; boost 120 m/s; run: on foot with the run key)
//     [--from=k] (start measuring at segment k: the board drives the shortest junction path there first, unmeasured; a repro of one
//     segment's frame, not the proof)
// The steering runs in the page (a 50 ms yaw toward the next waypoint); the keys are real. The walker is placed 20 m inside the
// home's east entryway by the in-page harness pose on preview or a loopback page; on staging (ZE15) a guest seat walks there from
// its spawn on Driftwood's pier. Never production (J205). A chunk that ends at the path's end (--from=70) also walks back in.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';
import { guardStagingSockets } from './staging-proof-lines.mjs';
/** ZE15 (ZE22): staging is a world build: a guest seat (J205, the socket guarded to the staging door), walked from its spawn on
 *  Driftwood's pier to the east entryway (grid-road-lag.mjs's approach), since an online seat can't be placed */
const STAGING_APPROACH = /** @type {[number, number][]} */ ([[235, -194], [235, 0]]);

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', '');
const limit = Number(flag('segments', '0')) || Infinity, ride = flag('ride', 'board'), from = Number(flag('from', '0'));
if (!['board', 'boost', 'run'].includes(ride)) throw new Error(`No ride ${ride}: board, boost or run`);
if (!/^https:\/\/(preview|staging)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: road-drive-proof.mjs --base=<preview or loopback url> --out=<dir> [--home=driftwood] [--segments=n]');
const HOMES = /** @type {Record<string, { slug: string, card: string }>} */ ({ driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle' }, sunscar: { slug: 'sunscar-dunes', card: 'Signal Dunes' }, pine: { slug: 'pine-hollow', card: 'Pine Hollow' } });
const homeName = flag('home', 'driftwood'), home = HOMES[homeName];
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
/** The cell's half size, the gap's half (road and both strips) and the junction offsets a drive keeps off the roundabout's island (6 m). */
const HALF = 250, GAP_HALF = 31.25, LANE = 4, AROUND = 10, CLEAR = 20, MEASURE_CLEAR = 30;
/** ZE3a: the page keeps its home resident while the feet are within this many metres of its edge (`liveSession.ts`
 *  HOME_KEEP_METRES 300), less a 20 m margin for the 50 ms sample's stride. */
const KEEP_M = 280;
/** The longest ramp back to cruise out of a corner the bar accepts: the board's own 90° turn takes about 0.8 s, a longer one is a stop. */
const RAMP_MS = 1500;
mkdirSync(out, { recursive: true });

/** The junction path: from the home's south-east junction to the lattice's corner, every row (a snake), every column (a snake),
 *  then back to the home's south-east junction. Each step is one segment. @param {number} n junction lines @param {number} si @param {number} sj */
function junctionPath(n, si, sj) {
  /** @type {[number, number][]} */
  const path = [[si, sj]];
  const go = (/** @type {number} */ i, /** @type {number} */ j) => {
    let [ci, cj] = /** @type {[number, number]} */ (path.at(-1));
    while (ci !== i) { ci += Math.sign(i - ci); path.push([ci, cj]); }
    while (cj !== j) { cj += Math.sign(j - cj); path.push([ci, cj]); }
  };
  const goJ = (/** @type {number} */ i, /** @type {number} */ j) => { let [ci, cj] = /** @type {[number, number]} */ (path.at(-1)); while (cj !== j) { cj += Math.sign(j - cj); path.push([ci, cj]); } while (ci !== i) { ci += Math.sign(i - ci); path.push([ci, cj]); } };
  goJ(0, 0);
  for (let j = 0; j < n; j++) { go(j % 2 === 0 ? n - 1 : 0, j); if (j < n - 1) go(/** @type {[number, number]} */ (path.at(-1))[0], j + 1); }
  for (let i = 0; i < n; i++) { const [ci] = /** @type {[number, number]} */ (path.at(-1)); if (ci !== i) go(i, /** @type {[number, number]} */ (path.at(-1))[1]); goJ(i, i % 2 === 0 ? 0 : n - 1); }
  go(si, /** @type {[number, number]} */ (path.at(-1))[1]); goJ(si, sj);
  return path;
}

const result = { base, home: home.slug, engine: engineName, ride, viewport: `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, at: new Date().toISOString(), build: '',
  segments: /** @type {Record<string, unknown>[]} */ ([]), back: /** @type {Record<string, unknown> | null} */ (null), summary: /** @type {Record<string, unknown> | null} */ (null), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
const tag = `${engineName}${device === '' ? '' : '-phone'}-${homeName}`;
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  if (phone !== undefined) result.viewport = `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  const staging = base === 'https://staging.wildshard.io';
  if (staging && homeName !== 'driftwood') throw new Error('staging walks from Driftwood\'s spawn only: --home=driftwood');
  if (staging) await context.addInitScript(guardStagingSockets, 'wss://rooms-staging.wildshard.io');
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1${staging ? '&fps=60' : ''}`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill(staging ? `ZE drive ${Date.now().toString(36).slice(-4)}` : 'roaddrive'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), home.card);
  if (index < 0) throw new Error(`No ${home.card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  // the lattice: junction lines halfway between cells, from the cells the page knows
  const grid = await page.evaluate(slug => {
    const W = /** @type {any} */ (window), st = W.__wildshard.shard.grid.state(), wf = st.live.live.worldFeet, p = W.__wildshard.world.player.position;
    const cells = /** @type {{ slug: string, cell: [number, number] }[]} */ (st.cells), own = cells.find(row => row.slug === slug);
    return { origin: { x: wf.x - p.x, z: wf.z - p.z }, cell: own?.cell ?? null, is: cells.map(row => row.cell[0]), js: cells.map(row => row.cell[1]) };
  }, home.slug);
  if (grid.cell === null) throw new Error(`${home.slug} is not on the grid`);
  const pitch = grid.cell[0] === 0 ? (grid.cell[1] === 0 ? 562.5 : grid.origin.z / grid.cell[1]) : grid.origin.x / grid.cell[0];
  const lo = Math.min(...grid.is, ...grid.js), hi = Math.max(...grid.is, ...grid.js), lines = Array.from({ length: hi - lo + 2 }, (_, k) => (lo + k - 0.5) * pitch);
  const at = (/** @type {number} */ v) => lines.findIndex(line => Math.abs(line - v) < 1);
  const si = at(grid.origin.x + HALF + GAP_HALF), sj = at(grid.origin.z - HALF - GAP_HALF);
  if (si < 0 || sj < 0) throw new Error('The home has no south-east junction on the lattice');
  const path = junctionPath(lines.length, si, sj), centre = (lines[0] + /** @type {number} */ (lines.at(-1))) / 2;
  // each segment's straight: LANE m to the grid-centre side of its line, CLEAR m off each junction; at a junction, one point AROUND
  // m off its centre toward the way out (or toward the lane on a straight pass), clear of the island
  /** @type {{ x: number, z: number, seg: number }[]} */
  const waypoints = [];
  const legs = Math.min(path.length - 1, from + limit);
  // --from: a lead-in, the junction path from the home's south-east junction to segment `from`'s start, driven unmeasured (seg -5)
  /** @type {[number, number][]} */
  const lead = [];
  if (from > 0) {
    let [ci, cj] = [si, sj];
    const [ti, tj] = path[from];
    while (ci !== ti || cj !== tj) { lead.push([ci, cj]); if (ci !== ti) ci += Math.sign(ti - ci); else cj += Math.sign(tj - cj); }
  }
  const run = [...lead, ...path.slice(from, legs + 1)], segOf = (/** @type {number} */ r) => r < lead.length ? -5 : from + r - lead.length;
  for (let r = 0; r < run.length - 1; r++) {
    const [ai, aj] = run[r], [bi, bj] = run[r + 1];
    const a = { x: lines[ai] ?? 0, z: lines[aj] ?? 0 }, b = { x: lines[bi] ?? 0, z: lines[bj] ?? 0 }, d = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    const n = d.x !== 0 ? { x: 0, z: Math.sign(centre - a.z) || 1 } : { x: Math.sign(centre - a.x) || 1, z: 0 };
    waypoints.push({ x: a.x + d.x * CLEAR + n.x * LANE, z: a.z + d.z * CLEAR + n.z * LANE, seg: segOf(r) }, { x: b.x - d.x * CLEAR + n.x * LANE, z: b.z - d.z * CLEAR + n.z * LANE, seg: segOf(r) });
    const next = run[r + 2];
    if (next !== undefined) {
      const e = { x: Math.sign((lines[next[0]] ?? 0) - b.x), z: Math.sign((lines[next[1]] ?? 0) - b.z) }, straight = e.x === d.x && e.z === d.z;
      waypoints.push({ x: b.x + (straight ? n.x : e.x) * AROUND, z: b.z + (straight ? n.z : e.z) * AROUND, seg: -1 });
    }
  }
  // out of the home's east entryway onto its east road, then down to the first segment's start
  const exitAt = { x: grid.origin.x + HALF + GAP_HALF - LANE, z: grid.origin.z };
  if (staging) {
    const feet = () => page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet; return { x: Number(wf.x), z: Number(wf.z) }; });
    const turn = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
    await page.keyboard.down('ShiftLeft');
    for (const [x, z] of STAGING_APPROACH) {
      await page.keyboard.down('KeyW');
      for (let ends = Date.now() + 90_000, near = Infinity, last = { x: Infinity, z: Infinity, t: Date.now() }; Date.now() < ends && near > 3; await sleep(250)) {
        const now = await feet(), lx = now.x - grid.origin.x, lz = now.z - grid.origin.z;
        near = Math.hypot(lx - x, lz - z); await turn(Math.atan2(lx - x, lz - z));
        if (Math.hypot(now.x - last.x, now.z - last.z) >= 0.5) last = { x: now.x, z: now.z, t: Date.now() };
        else if (Date.now() - last.t > 1000) { await page.keyboard.press('Space'); last.t = Date.now(); }
      }
      await page.keyboard.up('KeyW');
    }
    await page.keyboard.up('ShiftLeft');
  } else await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [HALF - 20, 0]);
  // the page's first gesture builds its AudioContext (G325, SF67: `unlock.ts`, a ~70 to 130 ms native constructor kept out of the
  // boot). A player has touched and pressed many times before they reach the road; the harness pose skipped all of that, so one
  // gesture here (a key that does nothing in play) keeps that once-per-page cost out of the drive's frames.
  await page.keyboard.press('ScrollLock');
  await sleep(4000);
  const route = [{ ...exitAt, seg: -2 }, ...waypoints];
  // the board and its boost through the player's own toggles (what H and a double tap of H call)
  if (ride !== 'run') {
    await page.evaluate(boost => { const p = /** @type {any} */ (window).__wildshard.world.player; if (!p.hover) p.setHover(true); p.setBoost?.(boost); }, ride === 'boost');
    await sleep(800);
    if (!(await page.evaluate(() => /** @type {any} */ (window).__wildshard.world.player.hover === true))) throw new Error('The board did not take');
  }
  await page.evaluate(({ wps, homeSlug }) => {
    const W = /** @type {any} */ (window), q = W.__drive = { frames: /** @type {number[][]} */ ([]), samples: /** @type {any[]} */ ([]), at: 0, done: false, wps,
      programs: /** @type {any[]} */ ([]), slowLinks: /** @type {any[]} */ ([]), loafs: /** @type {any[]} */ ([]) };
    // what a long frame did: the programs it linked, a link the driver finished only when asked, and (Chromium) the long
    // animation frame's own scripts
    const renderer = W.__wildshard?.world?.game?.renderer, gl = renderer?.getContext?.(), known = new Set(renderer?.info?.programs);
    if (gl !== undefined) {
      const ask = gl.getProgramParameter.bind(gl);
      gl.getProgramParameter = (/** @type {WebGLProgram} */ handle, /** @type {number} */ name) => {
        const t0 = performance.now(), value = ask(handle, name), ms = performance.now() - t0;
        if (ms > 8) {
          const found = (renderer.info.programs ?? []).find((/** @type {any} */ row) => row.program === handle), row = { t: Math.round(t0), ms: Math.round(ms), name: String(found?.name ?? ''), key: String(found?.cacheKey ?? '').slice(-40), owners: /** @type {string[]} */ ([]) };
          q.slowLinks.push(row);
          // who drew it: the first few objects whose material now holds this program, by their ancestors' names
          setTimeout(() => { try {
            const seen = new Set();
            W.__wildshard.world.game.scene.traverse((/** @type {any} */ o) => {
              if (row.owners.length >= 4 || o.material === undefined) return;
              for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
                if (renderer.properties.get(m)?.currentProgram?.program !== handle) continue;
                const names = []; for (let node = o; node !== null && node !== undefined && names.length < 6; node = node.parent) names.push(String(node.name === '' ? node.type : node.name));
                const label = `${names.join('<')} [${String(m.name === '' ? m.type : m.name)}]`;
                if (!seen.has(label)) { seen.add(label); row.owners.push(label.slice(0, 220)); }
              }
            });
          } catch (error) { row.owners.push(String(error).slice(0, 120)); } }, 0);
        }
        return value;
      };
    }
    try { new PerformanceObserver(list => { for (const e of /** @type {any[]} */ (list.getEntries())) if (e.duration > 50) q.loafs.push({ t: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration ?? 0), render: Math.round((e.startTime + e.duration) - (e.renderStart > 0 ? e.renderStart : e.startTime + e.duration)),
      scripts: (e.scripts ?? []).filter((/** @type {any} */ x) => x.duration > 5).map((/** @type {any} */ x) => ({ ms: Math.round(x.duration), fn: String(x.sourceFunctionName ?? ''), src: `${String(x.sourceURL ?? '').split('/').at(-1) ?? ''}:${String(x.sourceCharPosition ?? '')}`, inv: String(x.invoker ?? '').slice(0, 80) })) }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch { /* WebKit has none */ }
    let last = performance.now();
    const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now), Number((now - last).toFixed(1))]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player, wf = st.live?.live?.worldFeet ?? p.position;
      const wp = q.wps[q.at];
      if (wp !== undefined) {
        // a waypoint counts within a stride of a 50 ms look at the speed held (3 m on foot, more on a board)
        const prev = q.samples.at(-1), reach = prev === undefined || prev.err !== undefined ? 3 : Math.max(3, Math.hypot(wf.x - prev.x, wf.z - prev.z) * 2.5);
        if (Math.hypot(wf.x - wp.x, wf.z - wp.z) < reach) q.at++;
        const to = q.wps[q.at];
        if (to === undefined) q.done = true; else p.yaw = Math.atan2(wf.x - to.x, wf.z - to.z);
      }
      q.samples.push({ t: Math.round(performance.now()), x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), seg: q.wps[q.at]?.seg ?? -3, inside: st.inside, card: st.cellLoading ?? null, stage: st.cellStage ?? null,
        res: st.live?.live?.residents ?? null, home: (st.live?.live?.residents ?? []).includes(homeSlug), mb: st.playingMB ?? null });
      for (const program of renderer?.info?.programs ?? []) if (!known.has(program)) {
        known.add(program);
        // who drew it (ZE3b: a program met first on the road is a warm-up miss; its owner names what to warm)
        const owners = /** @type {string[]} */ ([]);
        W.__wildshard.world.game.scene.traverse((/** @type {any} */ o) => {
          if (owners.length >= 4 || o.material === undefined) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            if (renderer.properties.get(m)?.currentProgram !== program) continue;
            const names = []; for (let node = o; node !== null && node !== undefined && names.length < 6; node = node.parent) names.push(String(node.name === '' ? node.type : node.name));
            const label = `${names.join('<')} [${String(m.name === '' ? m.type : m.name)}] visible=${String(o.visible)}`.slice(0, 260);
            if (!owners.includes(label)) owners.push(label);
          }
        });
        q.programs.push({ t: Math.round(performance.now()), name: String(program.name ?? ''), key: String(program.cacheKey ?? '').slice(0, 300), owners });
      }
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 50);
  }, { wps: route, homeSlug: home.slug });
  // --profile (Chromium): the page thread's CPU profile over the measured drive, for a long frame's cause
  const cdp = process.argv.includes('--profile') && engineName === 'chromium' ? await context.newCDPSession(page) : undefined;
  if (cdp !== undefined) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  const profileAt = await page.evaluate(() => performance.now());
  const t0 = Date.now();
  if (ride === 'run') await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  for (let seen = -1, since = Date.now(); ;) {
    const { reached, done, last } = await page.evaluate(() => { const q = /** @type {any} */ (window).__drive; return { reached: q.at, done: q.done, last: q.samples.at(-1) }; });
    if (done) break;
    if (reached !== seen) { seen = reached; since = Date.now(); if (reached % 12 === 0) console.log(`waypoint ${String(reached)}/${String(route.length)} after ${String(Math.round((Date.now() - t0) / 1000))} s`); }
    // a waypoint not reached in 90 s is a drive stuck on something: say where, and stop
    if (Date.now() - since > 90_000) throw new Error(`stuck before waypoint ${String(reached)} ${JSON.stringify(route[reached])}: last sample ${JSON.stringify(last)}`);
    await sleep(1000);
  }
  await page.keyboard.up('KeyW'); if (ride === 'run') await page.keyboard.up('ShiftLeft');
  if (cdp !== undefined) { const { profile } = await cdp.send('Profiler.stop'); writeFileSync(join(out, `${tag}-drive.cpuprofile.json`), JSON.stringify({ at: profileAt, profile })); }
  const driveMs = Date.now() - t0;
  // per segment: its straight, MEASURE_CLEAR m off each end, read from the samples and the frames between its first and last sample
  const { frames, samples, programs, slowLinks, loafs } = await page.evaluate(() => { const q = /** @type {any} */ (window).__drive; return { frames: q.frames, programs: q.programs, slowLinks: q.slowLinks, loafs: q.loafs, samples: q.samples.filter((/** @type {any} */ r) => r.err === undefined) }; });
  const edgeM = (/** @type {any} */ r) => Math.hypot(Math.max(0, Math.abs(r.x - grid.origin.x) - HALF), Math.max(0, Math.abs(r.z - grid.origin.z) - HALF));
  const firstOut = samples.findIndex((/** @type {any} */ r) => edgeM(r) > KEEP_M);
  // ZE3a: the home stays resident until the feet first pass KEEP_M from its edge (the page's 300 m keep), then may retire
  const allCards = samples.filter((/** @type {any} */ r) => r.card !== null), allHome = samples.slice(0, firstOut === -1 ? samples.length : firstOut).every((/** @type {any} */ r) => r.home === true);
  /** every frame over 50 ms, with what the page did around it (a ±400 ms window) */
  const longFrames = frames.filter((/** @type {number[]} */ r) => (r[1] ?? 0) > 50).map((/** @type {number[]} */ [t, ms]) => {
    const near = (/** @type {any} */ r) => r.t >= t - (ms ?? 0) - 400 && r.t <= t + 400, hit = samples.find(near);
    return { t, ms, seg: hit?.seg ?? null, at: hit === undefined ? null : { x: hit.x, z: hit.z }, res: hit?.res ?? null, mb: hit?.mb ?? null,
      programs: programs.filter(near).map((/** @type {any} */ r) => r.name), slowLinks: slowLinks.filter(near), loafs: loafs.filter(near) };
  });
  for (let k = from; k < legs; k++) {
    const rows = samples.filter((/** @type {any} */ r) => r.seg === k);
    if (rows.length < 3) { result.segments.push({ seg: k, driven: false }); continue; }
    const [ai, aj] = path[k], [bi, bj] = path[k + 1];
    const a = { x: lines[ai] ?? 0, z: lines[aj] ?? 0 }, b = { x: lines[bi] ?? 0, z: lines[bj] ?? 0 }, len = Math.hypot(b.x - a.x, b.z - a.z);
    const along = (/** @type {any} */ r) => ((r.x - a.x) * (b.x - a.x) + (r.z - a.z) * (b.z - a.z)) / len;
    const mid = rows.filter((/** @type {any} */ r) => along(r) >= MEASURE_CLEAR && along(r) <= len - MEASURE_CLEAR);
    const span = mid.length < 2 ? [] : frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= mid[0].t && (r[0] ?? 0) <= mid.at(-1).t).map((/** @type {number[]} */ r) => r[1] ?? 0);
    const speed = (/** @type {number} */ i) => Math.hypot(mid[i].x - mid[i - 1].x, mid[i].z - mid[i - 1].z) / Math.max(1, mid[i].t - mid[i - 1].t);
    const speeds = mid.map((/** @type {unknown} */ _, /** @type {number} */ i) => i > 0 ? speed(i) : Number.NaN).filter((/** @type {number} */ v) => Number.isFinite(v)).sort((/** @type {number} */ x, /** @type {number} */ y) => x - y), cruise = speeds[Math.floor(speeds.length / 2)] ?? 0;
    // out of a turn the board is still gaining speed: a stop counts only once the segment first reaches 90 % of its cruise (the
    // 2026-11-15 laptop drive: every stop over 105 ms was this ramp out of a 90° corner, each frame 16.8 ms)
    let stop = 0, worstStop = 0, stopAt = null, ramp = 1;
    while (ramp < mid.length && speed(ramp) < cruise * 0.9) ramp++;
    const rampMs = ramp < mid.length ? mid[ramp - 1].t - mid[0].t : 0;
    for (let i = ramp + 1; i < mid.length; i++) { stop = speed(i) < cruise * 0.9 ? stop + (mid[i].t - mid[i - 1].t) : 0; if (stop > worstStop) { worstStop = stop; stopAt = { x: mid[i].x, z: mid[i].z }; } }
    const cards = rows.filter((/** @type {any} */ r) => r.card !== null), mbs = rows.map((/** @type {any} */ r) => r.mb).filter((/** @type {unknown} */ v) => typeof v === 'number');
    result.segments.push({ seg: k, driven: true, from: [ai, aj], to: [bi, bj], ms: rows.at(-1).t - rows[0].t, cruiseMps: Number((cruise * 1000).toFixed(2)), worstFrameMs: Math.max(0, ...span),
      over50: span.filter((/** @type {number} */ ms) => ms > 50).length, over100: span.filter((/** @type {number} */ ms) => ms > 100).length, worstStopMs: worstStop, stopAt, rampMs,
      cardMs: cards.length * 50, cards: [...new Set(cards.map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], homeResident: rows.every((/** @type {any} */ r) => r.home === true),
      residents: [...new Set(rows.flatMap((/** @type {any} */ r) => r.res ?? []))], mb: mbs.length === 0 ? null : { min: Math.min(...mbs), max: Math.max(...mbs) },
      programs: programs.filter((/** @type {any} */ r) => r.t >= rows[0].t && r.t <= rows.at(-1).t).length });
  }
  // back to the home's east entryway and in, by input: control with no card (a short --segments check ends away from home)
  const whole = legs === path.length - 1; // opus-gcm18: the last chunk (--from=70) also walks back in
  const backFrom = await page.evaluate(() => Math.round(performance.now()));
  await page.evaluate(([wps]) => { const q = /** @type {any} */ (window).__drive; q.wps = wps; q.at = 0; q.done = false; }, [[{ x: grid.origin.x + HALF + GAP_HALF - LANE, z: grid.origin.z, seg: -4 }, { x: grid.origin.x + HALF - 12, z: grid.origin.z, seg: -4 }]]);
  if (whole) {
    await page.keyboard.down('KeyW');
    for (const ends = Date.now() + 120_000; Date.now() < ends;) { if (await page.evaluate(() => /** @type {any} */ (window).__drive.done)) break; await sleep(250); }
    await page.keyboard.up('KeyW');
    await sleep(2500);
  }
  result.back = await page.evaluate(({ after, slug }) => {
    const W = /** @type {any} */ (window), q = W.__drive, rows = q.samples.filter((/** @type {any} */ r) => r.err === undefined && r.t >= after), st = W.__wildshard.shard.grid.state();
    const span = q.frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= after).map((/** @type {number[]} */ r) => r[1] ?? 0);
    return { reached: q.done === true, inside: st.inside === slug, control: st.live?.live?.gameplayReady === true, cardMs: rows.filter((/** @type {any} */ r) => r.card !== null).length * 50,
      cards: [...new Set(rows.filter((/** @type {any} */ r) => r.card !== null).map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], worstFrameMs: Math.max(0, ...span), over50: span.filter((/** @type {number} */ ms) => ms > 50).length };
  }, { after: backFrom, slug: home.slug });
  await page.screenshot({ path: join(out, `${tag}-road-drive.png`) });
  const driven = result.segments.filter(row => row.driven === true), mbAll = driven.flatMap(row => { const mb = /** @type {any} */ (row.mb); return mb === null ? [] : [mb.min, mb.max]; });
  const phoneBar = device !== '' ? 1 : 0, over50 = driven.reduce((sum, row) => sum + Number(row.over50), 0);
  result.summary = { driveMs, from, segments: legs - from, driven: driven.length, over50, worstFrameMs: Math.max(0, ...driven.map(row => Number(row.worstFrameMs))), worstStopMs: Math.max(0, ...driven.map(row => Number(row.worstStopMs))),
    worstRampMs: Math.max(0, ...driven.map(row => Number(row.rampMs ?? 0))),
    cardMs: allCards.length * 50, cards: [...new Set(allCards.map((/** @type {any} */ r) => `${String(r.card)}:${String(r.stage)}`))], homeResident: allHome, homeKeptToM: KEEP_M, longFrames,
    newPrograms: programs.map((/** @type {any} */ r) => ({ t: r.t, seg: samples.find((/** @type {any} */ x) => x.t >= r.t)?.seg ?? null, name: r.name, owners: r.owners, key: r.key })), mbGrowth: mbAll.length === 0 ? null : Math.max(...mbAll) - (/** @type {any} */ (driven[0]?.mb)?.min ?? 0),
    bar: driven.length === legs - from && over50 <= phoneBar && driven.every(row => Number(row.worstStopMs) <= 250 && Number(row.rampMs ?? 0) <= RAMP_MS) && allCards.length === 0 && allHome && result.errors.length === 0 };
  console.log(`${result.summary.bar === true ? 'ok  ' : 'FAIL'} ${homeName} drive ${JSON.stringify(result.summary)}`);
  console.log(`${result.back.inside === true && result.back.cardMs === 0 ? 'ok  ' : 'FAIL'} ${homeName} back in ${JSON.stringify(result.back)}`);
  await context.close();
  code = result.summary.bar === true && (!whole || result.back.inside === true && result.back.cardMs === 0) ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${tag}-road-drive.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
