#!/usr/bin/env node
// Road lag (Jake, 2026-11-15: "Last time I tried going to the road, there was a lot of lag"): from a home cell, step out of its
// entryway onto the road and back in, by real input, a few times, and measure what the player feels at each line: every frame's
// time (requestAnimationFrame) in the window from 1 s before to 3 s after the feet cross, any loading card on screen in it, and the
// longest stretch under 90 % of the approach speed with the key held (the road bar's stop). One JSON per run, plus a printed line per crossing.
//   src/scripts/browser-lane.sh node src/scripts/grid-road-lag.mjs --base=<staging, preview or loopback> --out=<dir> [--home=driftwood|nalati]
//     [--viewport=2992x1434@2] [--reps=3] [--engine=chromium|webkit] [--run] (sprint) [--device='iPhone 15 Pro'] (a phone: its viewport, touch and agent)
//     [--profile] (Chromium: the page thread's CPU profile over the first lap, with `at`, its start on the page's clock)
//     [--online] (a loopback world build, as road-lag-rig.mjs runs it: the walked approach, as on staging)
// On preview or a loopback page the walker is set 20 m inside the home cell's road-facing entryway by the in-page harness pose; on
// staging (an online seat can't be placed) only Driftwood is walked to its east entryway from the spawn. Never production (J205).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, devices, webkit } from "./browser-playwright.mjs";
import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
/** A program row on a crossing's clock (`at`, its line), its `again` and `released` marks only when set. @param {any} r @param {number} at */
const programRow = (r, at) => ({ t: r.t - at, name: r.name, key: r.key, ...(r.again === true ? { again: true } : {}), ...(r.released === true ? { released: true } : {}) });
/** A row on a crossing's clock. @param {any} r @param {number} at */
const shifted = (r, at) => ({ ...r, t: r.t - at });
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), device = flag('device', ''), run = process.argv.includes('--run'), profile = process.argv.includes('--profile'), reps = Number(flag('reps', '3'));
if (!/^https:\/\/(preview|staging)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: grid-road-lag.mjs --base=<staging, preview or loopback url> --out=<dir> [--home=driftwood|nalati] [--viewport=WxH@dpr] [--reps=n]');
// `--online`: a loopback world build's page (road-lag-rig.mjs's local rig), walked as staging is: its seat can't be placed
const online = base.includes('staging') || process.argv.includes('--online');
/** Each home's road-facing entryway (the middle of an edge, in the cell's own metres) and the yaw that walks out through it (the
 *  page's motor faces atan2(own - target): +x is -π/2, -x is π/2, +z is π, -z is 0). Driftwood's east faces Nalati, Nalati's west faces Driftwood. */
const HOMES = /** @type {Record<string, { slug: string, card: string, axis: 'x' | 'z', sign: number, approach: [number, number][] }>} */ ({
  driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle', axis: 'x', sign: 1, approach: [[235, -194], [235, 0]] },
  nalati: { slug: 'nalati-grasslands', card: 'Nalati Grasslands', axis: 'x', sign: -1, approach: [] },
  sunscar: { slug: 'sunscar-dunes', card: 'Signal Dunes', axis: 'x', sign: 1, approach: [] },
  pine: { slug: 'pine-hollow', card: 'Pine Hollow', axis: 'x', sign: 1, approach: [] } });
const homeName = flag('home', 'driftwood'), home = HOMES[homeName];
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
if (online && home.approach.length === 0) throw new Error(`${homeName} has no walked approach for an online seat: use preview or a loopback page`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });

const result = { base, home: home.slug, engine: engineName, viewport: `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, at: new Date().toISOString(), build: '', crossings: /** @type {Record<string, unknown>[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '', crossingTiming: /** @type {unknown} */ (null) };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const phone = device === '' ? undefined : devices[device];
  if (device !== '' && phone === undefined) throw new Error(`No Playwright device ${device}`);
  if (phone !== undefined) result.viewport = `${device} ${String(phone.viewport.width)}x${String(phone.viewport.height)}@${String(phone.deviceScaleFactor)}`;
  const context = await browser.newContext(phone ?? { viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
  page.on('pageerror', error => { result.errors.push(error.message.slice(0, 240)); });
  await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
  await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
  await saveFixture(context, { scope: 'global', key: 'settings', merge: true, data: { volume: 0 } });
  await page.goto(`${base}/?mute=1&nolock=1`, { waitUntil: 'load' });
  await page.locator('.ws-main-select').click({ timeout: 120_000 });
  if (await page.locator('#ws-name-box input').waitFor({ timeout: 30_000 }).then(() => true).catch(() => false)) { await page.locator('#ws-name-box input').fill('roadlag'); await page.locator('#ws-name-box button[type=submit]').click(); }
  await page.locator('.ws-menu-card').first().waitFor({ state: 'visible', timeout: 30_000 });
  const index = await page.evaluate(card => [...document.querySelectorAll('.ws-menu-card')].findIndex(row => (row.textContent ?? '').includes(card)), home.card);
  if (index < 0) throw new Error(`No ${home.card} card`);
  await page.locator('.ws-menu-dots i').nth(index).click();
  await page.locator('.ws-menu-play').click();
  await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state?.().live?.live?.gameplayReady === true, undefined, { timeout: 180_000, polling: 100 });
  await sleep(2000);
  await page.getByText('DONE', { exact: true }).click({ timeout: 2000 }).catch(() => undefined);
  // every drawn frame [t, ms] and a 50 ms sample of where the feet are and what the screen shows
  await page.evaluate(() => {
    const W = /** @type {any} */ (window), q = W.__road = { frames: /** @type {number[][]} */ ([]), samples: /** @type {any[]} */ ([]), programs: /** @type {any[]} */ ([]), slowLinks: /** @type {any[]} */ ([]) };
    // every shader program the renderer links, with when it was first seen: a crossing that compiles one stalls its frame
    const known = new Set(W.__wildshard?.world?.game?.renderer?.info?.programs);
    // a key linked once before and released since links again: `again` tells a re-link from a first link
    const seenKeys = new Set([...known].map((/** @type {any} */ program) => String(program.cacheKey)));
    let held = new Set(known);
    // and every program whose first use blocked the page (a link the driver finished only when asked): which, and how long

    const renderer = W.__wildshard?.world?.game?.renderer, gl = renderer?.getContext?.();
    if (gl !== undefined) {
      const ask = gl.getProgramParameter.bind(gl);
      gl.getProgramParameter = (/** @type {WebGLProgram} */ handle, /** @type {number} */ name) => {
        const t0 = performance.now(), value = ask(handle, name), ms = performance.now() - t0;
        if (ms > 8) {
          const all = renderer.info.programs ?? [], found = all.find((/** @type {any} */ row) => row.program === handle), key = String(found?.cacheKey ?? '');
          // ZE2d: what this link differs in from the same material's programs already linked: the key's comma fields that differ
          const custom = (/** @type {string} */ k) => k.slice(Math.max(0, k.lastIndexOf(',srgb,'))), head = (/** @type {string} */ k) => k.slice(0, Math.max(0, k.lastIndexOf(',srgb,')));
          const fields = head(key).split(','), siblings = all.filter((/** @type {any} */ row) => row !== found && row.name === found?.name && custom(String(row.cacheKey)) === custom(key)).map((/** @type {any} */ row) => head(String(row.cacheKey)).split(','));
          const diffs = siblings.slice(0, 4).map((/** @type {string[]} */ other) => other.length !== fields.length ? `len ${String(other.length)}/${String(fields.length)}` : fields.map((f, i) => f === other[i] ? null : `${String(i)}:${other[i] ?? ''}->${f}`).filter(x => x !== null).join(' '));
          // who drew it
          const owners = /** @type {string[]} */ ([]);
          try { W.__wildshard.world.game.scene.traverse((/** @type {any} */ o) => { if (owners.length >= 3 || o.material === undefined) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (renderer.properties.get(m)?.currentProgram?.program === handle) { const n = []; for (let at = o; at !== null && at !== undefined && n.length < 5; at = at.parent) n.push(String(at.name === '' ? at.type : at.name)); owners.push(n.join('<')); } }); } catch { /* best effort */ }
          q.slowLinks.push({ t: Math.round(t0), ms: Math.round(ms), name: String(found?.name ?? ''), fields: fields.length, tail: fields.slice(-24).join(','), diffs, owners, env: String(W.__wildshard.world.game.scene.environment?.image?.height ?? null) });
        }
        return value;
      };
    }
    let last = performance.now();
    const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now), Number((now - last).toFixed(1))]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player;
      const wf = st.live?.live?.worldFeet ?? p.position;
      const now = W.__wildshard.world.game?.renderer?.info?.programs ?? [];
      for (const program of now) if (!known.has(program)) { known.add(program); const key = String(program.cacheKey ?? ''); q.programs.push({ t: Math.round(performance.now()), name: String(program.name ?? ''), key: key.length > 700 && !/creature|wildlife/u.test(String(program.name)) ? `${key.slice(0, 300)} … ${key.slice(-300)}` : key, again: seenKeys.has(key) }); seenKeys.add(key); }
      const live = new Set(now);
      for (const program of held) if (!live.has(program)) q.programs.push({ t: Math.round(performance.now()), name: String(program.name ?? ''), key: ((k) => k.length > 700 ? `${k.slice(0, 300)} … ${k.slice(-300)}` : k)(String(program.cacheKey ?? '')), released: true });
      held = live;
      q.samples.push({ t: Math.round(performance.now()), x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), inside: st.inside, phase: st.live?.crossing?.phase ?? null, card: st.cellLoading ?? null, stage: st.cellStage ?? null, ready: st.live?.live?.gameplayReady, res: st.live?.live?.residents ?? null, cx: st.live?.live?.crossings ?? null, cur: st.live?.live?.current ?? null, hy: st.runtimePage?.instance ?? null, hook: st.runtimePage?.hook ?? null });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 700) }); } }, 50);
  });
  const sample = () => page.evaluate(() => { const rows = /** @type {any[]} */ (/** @type {any} */ (window).__road.samples); for (let at = rows.length - 1; at >= 0; at--) if (rows[at].err === undefined) return rows[at]; return undefined; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  const edge = 250, along = home.axis;
  if (online) {
    await page.keyboard.down('ShiftLeft');
    for (const [x, z] of home.approach) {
      await page.keyboard.down('KeyW');
      // a body held by a post or rail (the local rig's fresh seat spawns on Driftwood's pier) hops it: no 0.5 m in a second jumps
      for (let ends = Date.now() + 90_000, near = Infinity, last = { x: Infinity, z: Infinity, t: Date.now() }; Date.now() < ends && near > 3; await sleep(250)) {
        const at = await sample(); if (at === undefined) continue; // no clean sample yet (WebKit's slower first frames)
        near = Math.hypot(at.x - x, at.z - z); await face(Math.atan2(at.x - x, at.z - z));
        if (Math.hypot(at.x - last.x, at.z - last.z) >= 0.5) last = { x: at.x, z: at.z, t: Date.now() };
        else if (Date.now() - last.t > 1000) { await page.keyboard.press('Space'); last.t = Date.now(); }
      }
      const rows = /** @type {any} */ (result); rows.approach ??= []; rows.approach.push(await sample());
      await page.keyboard.up('KeyW');
    }
    await page.keyboard.up('ShiftLeft');
  } else {
    const [x, z] = along === 'x' ? [home.sign * (edge - 20), 0] : [0, home.sign * (edge - 20)];
    await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [x, z]);
  }
  await sleep(4000);
  // ZE2d: what the boot prelinked for the road before the first walk out: each road program's environment height and light
  // fields (the key's 3, 4, 51, 52), and the environments the page and the root scene hold now
  /** @type {any} */ (result).bootRoad = await page.evaluate(() => {
    const W = /** @type {any} */ (window), game = W.__wildshard.world.game, height = (/** @type {any} */ t) => t?.image?.height ?? null;
    const programs = (game.renderer.info.programs ?? []).filter((/** @type {any} */ p) => String(p.name).startsWith('grid-')).map((/** @type {any} */ p) => { const f = String(p.cacheKey).split(','); return `${String(p.name)} ${f[3] ?? ''} ${f[4] ?? ''} ${f[51] ?? ''} ${f[52] ?? ''}`; });
    // and the home's creatures: each graph body's linked programs (key fields 3, 4, 51, 52) and the hidden warm rigs (DL24)
    // parked anywhere in the page, by material
    const creatures = (game.renderer.info.programs ?? []).filter((/** @type {any} */ p) => /creature|wildlife/u.test(String(p.name))).map((/** @type {any} */ p) => `${String(p.name)} ${String(p.cacheKey)}`);
    const warm = /** @type {string[]} */ ([]);
    for (const root of [game.scene, game.rootScene]) root?.traverse((/** @type {any} */ o) => { if (o.name !== 'creature-warm') return; o.traverse((/** @type {any} */ m) => { for (const mat of m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material]) warm.push(`${String(mat.name === '' ? mat.type : mat.name)}${(o.parent?.name ?? '') === '' ? '' : ` in ${String(o.parent.name)}`}`); }); });
    return { programs, creatures, warm: [...new Set(warm)], scene: height(game.scene.environment), root: height(game.rootScene?.environment), exterior: W.__wildshard.shard.grid.exterior?.() ?? 'none', sameScene: game.scene === game.rootScene };
  });
  if (process.argv.includes('--reprelink')) {
    await page.evaluate(() => { /** @type {any} */ (window).__wildshard.shard.grid.prelink(); });
    await sleep(5000);
    /** @type {any} */ (result).bootRoadAgain = await page.evaluate(() => (/** @type {any} */ (window).__wildshard.world.game.renderer.info.programs ?? []).filter((/** @type {any} */ p) => String(p.name).startsWith('grid-')).map((/** @type {any} */ p) => { const f = String(p.cacheKey).split(','); return `${String(p.name)} ${f[3] ?? ''} ${f[4] ?? ''} ${f[51] ?? ''} ${f[52] ?? ''}`; }));
  }
  // the walk's lines are in the home's own coordinates: world feet less the home cell's origin
  const originAt = await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; });
  const local = (/** @type {any} */ s) => s[along] - originAt[along];
  const outward = along === 'x' ? (home.sign > 0 ? -Math.PI / 2 : Math.PI / 2) : (home.sign > 0 ? Math.PI : 0);
  let heldUntil = Infinity;
  const t = () => page.evaluate(() => Math.round(performance.now()));
  /** Walk with W held until `done(sample)` or 40 s; returns the wall time it took. */
  const walk = async (/** @type {number} */ yaw, /** @type {(s: any) => boolean} */ done) => {
    await face(yaw); if (run) await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyW');
    const t0 = Date.now();
    for (let s = await sample(); Date.now() - t0 < 40_000 && !done(s); s = await sample()) await sleep(100);
    heldUntil = await t(); await page.keyboard.up('KeyW'); if (run) await page.keyboard.up('ShiftLeft'); return Date.now() - t0;
  };
  /** One crossing's numbers from the page's frames and samples around the first sample past the line */
  const measure = async (/** @type {string} */ name, /** @type {number} */ fromT) => {
    const { frames, samples, programs, slowLinks } = await page.evaluate(after => { const q = /** @type {any} */ (window).__road; return { slowLinks: /** @type {any[]} */ (q.slowLinks.filter((/** @type {any} */ r) => r.t >= after)), programs: /** @type {any[]} */ (q.programs.filter((/** @type {any} */ r) => r.t >= after)), frames: /** @type {number[][]} */ (q.frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= after)), samples: /** @type {any[]} */ (q.samples.filter((/** @type {any} */ r) => r.err === undefined && r.t >= after)) }; }, fromT);
    const leaving = name.startsWith('out'), line = samples.find((s, i) => i > 0 && (leaving ? s.inside === null && samples[i - 1].inside !== null : s.inside === home.slug && samples[i - 1].inside !== home.slug));
    if (line === undefined) return { name, crossed: false };
    const span = frames.filter(r => (r[0] ?? 0) >= line.t - 1000 && (r[0] ?? 0) <= line.t + 3000).map(r => r[1] ?? 0), sorted = [...span].sort((a, b) => a - b);
    const cards = samples.filter(s => s.t >= line.t - 1000 && s.t <= line.t + 3000 && s.card !== null);
    // the road bar's stop: ground speed under 90 % of the approach's median, counted only while the key is held
    let stop = 0, worstStop = 0;
    const near = samples.filter(s => s.t >= line.t - 1000 && s.t <= line.t + 3000), held = near.filter(s => s.t <= heldUntil);
    const speed = (/** @type {number} */ i) => Math.hypot(held[i].x - held[i - 1].x, held[i].z - held[i - 1].z) / Math.max(1, held[i].t - held[i - 1].t);
    const approach = held.map((_, i) => i > 0 && held[i].t < line.t - 200 ? speed(i) : Number.NaN).filter(v => Number.isFinite(v)).sort((a, b) => a - b), cruise = approach[Math.floor(approach.length / 2)] ?? 0;
    let stopAt = null;
    // a walk that starts within the window starts from rest: count only once the feet first reach the approach's speed
    for (let i = 1, moving = false; i < held.length; i++) { const slow = speed(i) < cruise * 0.9; moving ||= !slow; if (!moving) continue; stop = slow ? stop + (held[i].t - held[i - 1].t) : 0; if (stop > worstStop) { worstStop = stop; stopAt = { endsMs: held[i].t - line.t, x: held[i].x, z: held[i].z }; } }
    return { name, crossed: true, lineAt: line.t, frames: span.length, worstFrameMs: sorted.at(-1) ?? 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      over33: span.filter(ms => ms > 33.4).length, over50: span.filter(ms => ms > 50).length, over100: span.filter(ms => ms > 100).length,
      trace: near.filter((_, i) => i % 2 === 0).map(s => [s.t - line.t, s.x, s.z, s.inside, s.cur, s.cx, s.phase, s.card, s.stage, s.res, s.hy, s.hook]), cardMs: cards.length * 50, cards: [...new Set(cards.map(s => `${String(s.card)}:${String(s.stage)}`))], worstStopMs: worstStop, stopAt, cruiseMps: Number((cruise * 1000).toFixed(2)), phases: [...new Set(near.map(s => s.phase))],
      programs: programs.filter(r => r.t >= line.t - 1000 && r.t <= line.t + 3000).map(r => programRow(r, line.t)),
      releasedBefore: programs.filter(r => r.released === true && r.t < line.t - 1000).map(r => ({ t: r.t - line.t, name: r.name, key: r.key })),
      slowLinks: slowLinks.filter(r => r.t >= line.t - 1000 && r.t <= line.t + 3000).map(r => shifted(r, line.t)) };
  };
  const cdp = profile && engineName === 'chromium' ? await context.newCDPSession(page) : undefined;
  let profileAt = 0;
  // --profile-lap=<n>: the profile covers that lap (default the first; a later lap shows what a warm page still pays)
  const profileLap = Number(flag('profile-lap', '1'));
  if (cdp !== undefined) await cdp.send('Profiler.enable');
  for (let rep = 1; rep <= reps; rep++) {
    if (cdp !== undefined && rep === profileLap) { await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); profileAt = await t(); }
    let from = await t();
    await walk(outward, s => s.inside === null && Math.abs(local(s)) >= edge + 12);
    await sleep(2500);
    result.crossings.push({ rep, ...await measure('out (cell to road)', from) });
    from = await t();
    await walk(outward + Math.PI, s => s.inside === home.slug && Math.abs(local(s)) <= edge - 12);
    await sleep(2500);
    result.crossings.push({ rep, ...await measure('back (road to cell)', from) });
    if (cdp !== undefined && rep === profileLap) {
      const { profile: taken } = await cdp.send('Profiler.stop');
      writeFileSync(join(out, `${engineName}${device === '' ? '' : '-phone'}${run ? '-run' : ''}-${homeName}-lap${String(profileLap)}.cpuprofile.json`), JSON.stringify({ at: profileAt, base, profile: taken }));
    }
    for (const row of result.crossings.slice(-2)) console.log(`${row.crossed === true ? 'ok  ' : 'FAIL'} ${homeName} rep ${String(rep)} ${String(row.name)} ${JSON.stringify({ worst: row.worstFrameMs, p95: row.p95Ms, over50: row.over50, over100: row.over100, card: row.cardMs, stop: row.worstStopMs })}`);
  }
  await page.screenshot({ path: join(out, `${engineName}${device === '' ? '' : '-phone'}${run ? '-run' : ''}-${homeName}-road-lag.png`) });
  // ZE2d: every road program the run linked or released, by page time (the crossings' `lineAt` place them)
  /** @type {any} */ (result).roadPrograms = await page.evaluate(() => /** @type {any[]} */ (/** @type {any} */ (window).__road.programs).filter(p => String(p.name).startsWith('grid-') || p.name === '').map(p => { const f = String(p.key).split(','); return `${String(p.t)} ${String(p.name)} ${f[3] ?? ''} ${f[4] ?? ''} ${f[51] ?? ''} ${f[52] ?? ''}${p.released === undefined ? '' : ' released'}`; }));
  result.crossingTiming = await page.evaluate(() => /** @type {any} */ (window).__wildshard.shard.grid.state().live?.crossingTiming ?? null);
  await context.close();
  code = result.crossings.every(row => row.crossed === true) && result.errors.length === 0 ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${engineName}${device === '' ? '' : '-phone'}${run ? '-run' : ''}-${homeName}-road-lag.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
