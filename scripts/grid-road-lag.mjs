#!/usr/bin/env node
// Road lag (Jake, 2026-11-15: "Last time I tried going to the road, there was a lot of lag"): from a home cell, step out of its
// entryway onto the road and back in, by real input, a few times, and measure what the player feels at each line: every frame's
// time (requestAnimationFrame) in the window from 1 s before to 3 s after the feet cross, any loading card on screen in it, and the
// longest stretch under 90 % of the approach speed with the key held (the road bar's stop). One JSON per run, plus a printed line per crossing.
//   scripts/browser-lane.sh node scripts/grid-road-lag.mjs --base=<staging, preview or loopback> --out=<dir> [--home=driftwood|nalati]
//     [--viewport=2992x1434@2] [--reps=3] [--engine=chromium|webkit]
// On preview or a loopback page the walker is set 20 m inside the home cell's road-facing entryway by the in-page harness pose; on
// staging (an online seat can't be placed) only Driftwood is walked to its east entryway from the spawn. Never production (J205).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { chromium, webkit } from 'playwright';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
import { saveFixture } from './debug-settings.mjs';

/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = flag('base', '').replace(/\/$/u, ''), out = absolute(flag('out', '')), engineName = flag('engine', 'chromium'), reps = Number(flag('reps', '3'));
if (!/^https:\/\/(preview|staging)\.wildshard\.io$|^http:\/\/127\.0\.0\.1:\d+$/u.test(base) || out === absolute('')) throw new Error('usage: grid-road-lag.mjs --base=<staging, preview or loopback url> --out=<dir> [--home=driftwood|nalati] [--viewport=WxH@dpr] [--reps=n]');
const online = base.includes('staging');
/** Each home's road-facing entryway (the middle of an edge, in the cell's own metres) and the yaw that walks out through it (the
 *  page's motor faces atan2(own - target): +x is -π/2, -x is π/2, +z is π, -z is 0). Driftwood's east faces Nalati, Nalati's west faces Driftwood. */
const HOMES = /** @type {Record<string, { slug: string, card: string, axis: 'x' | 'z', sign: number, approach: [number, number][] }>} */ ({
  driftwood: { slug: 'driftwood-isle', card: 'Driftwood Isle', axis: 'x', sign: 1, approach: [[235, -194], [235, 0]] },
  nalati: { slug: 'nalati-grasslands', card: 'Nalati Grasslands', axis: 'x', sign: -1, approach: [] } });
const homeName = flag('home', 'driftwood'), home = HOMES[homeName];
if (home === undefined) throw new Error(`No home ${homeName}: ${Object.keys(HOMES).join(', ')}`);
if (online && home.approach.length === 0) throw new Error(`${homeName} has no walked approach for an online seat: use preview or a loopback page`);
const desk = (/^(\d+)x(\d+)@([\d.]+)$/u.exec(flag('viewport', '2992x1434@2')) ?? [0, '2992', '1434', '2']).slice(1).map(Number);
const sleep = (/** @type {number} */ ms) => new Promise(resolve => { setTimeout(resolve, ms); });
mkdirSync(out, { recursive: true });

const result = { base, home: home.slug, engine: engineName, viewport: `${String(desk[0])}x${String(desk[1])}@${String(desk[2])}`, at: new Date().toISOString(), build: '', crossings: /** @type {Record<string, unknown>[]} */ ([]), errors: /** @type {string[]} */ ([]), note: '' };
const browser = await (engineName === 'webkit' ? webkit : chromium).launch({ headless: true, args: engineName === 'chromium' ? [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] : [] });
let code = 1;
try {
  result.build = await fetch(`${base}/version.json`).then(async found => String((await found.json()).build)).catch(() => '');
  const context = await browser.newContext({ viewport: { width: desk[0] ?? 2992, height: desk[1] ?? 1434 }, deviceScaleFactor: desk[2] ?? 2 }), page = await context.newPage();
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
    const W = /** @type {any} */ (window), q = W.__road = { frames: /** @type {number[][]} */ ([]), samples: /** @type {any[]} */ ([]) };
    let last = performance.now();
    const raf = (/** @type {number} */ now) => { q.frames.push([Math.round(now), Number((now - last).toFixed(1))]); last = now; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    setInterval(() => { try {
      const st = W.__wildshard.shard.grid.state(), p = W.__wildshard.world.player;
      const wf = st.live?.live?.worldFeet ?? p.position;
      q.samples.push({ t: Math.round(performance.now()), x: Number(wf.x.toFixed(2)), z: Number(wf.z.toFixed(2)), inside: st.inside, phase: st.live?.crossing?.phase ?? null, card: st.cellLoading ?? null, stage: st.cellStage ?? null, ready: st.live?.live?.gameplayReady, res: st.live?.live?.residents ?? null, cx: st.live?.live?.crossings ?? null, cur: st.live?.live?.current ?? null, hy: st.hybrid?.instance ?? null, hook: st.hybrid?.hook ?? null });
    } catch (error) { q.samples.push({ err: String(error).slice(0, 160) }); } }, 50);
  });
  const sample = () => page.evaluate(() => { const rows = /** @type {any[]} */ (/** @type {any} */ (window).__road.samples); for (let at = rows.length - 1; at >= 0; at--) if (rows[at].err === undefined) return rows[at]; return undefined; });
  const face = (/** @type {number} */ yaw) => page.evaluate(wanted => { /** @type {any} */ (window).__wildshard.world.player.yaw = wanted; }, yaw);
  const edge = 250, along = home.axis;
  if (online) {
    await page.keyboard.down('ShiftLeft');
    for (const [x, z] of home.approach) {
      await page.keyboard.down('KeyW');
      for (let ends = Date.now() + 90_000, near = Infinity; Date.now() < ends && near > 3; await sleep(250)) {
        const at = await sample(); near = Math.hypot(at.x - x, at.z - z); await face(Math.atan2(at.x - x, at.z - z));
      }
      await page.keyboard.up('KeyW');
    }
    await page.keyboard.up('ShiftLeft');
  } else {
    const [x, z] = along === 'x' ? [home.sign * (edge - 20), 0] : [0, home.sign * (edge - 20)];
    await page.evaluate(([px, pz]) => { const p = /** @type {any} */ (window).__wildshard.world.player; p.spawn(px, pz, p.yaw, 1.5); p.link?.place?.(p.position.x, p.position.y, p.position.z, p.yaw); }, [x, z]);
  }
  await sleep(4000);
  // the walk's lines are in the home's own coordinates: world feet less the home cell's origin
  const originAt = /** @type {{ x: number, z: number }} */ (await page.evaluate(() => { const W = /** @type {any} */ (window), wf = W.__wildshard.shard.grid.state().live.live.worldFeet, p = W.__wildshard.world.player.position; return { x: wf.x - p.x, z: wf.z - p.z }; }));
  const local = (/** @type {any} */ s) => s[along] - originAt[along];
  const outward = along === 'x' ? (home.sign > 0 ? -Math.PI / 2 : Math.PI / 2) : (home.sign > 0 ? Math.PI : 0);
  let heldUntil = Infinity;
  /** Walk with W held until `done(sample)` or 40 s; returns the wall time it took. */
  const walk = async (/** @type {number} */ yaw, /** @type {(s: any) => boolean} */ done) => {
    await face(yaw); await page.keyboard.down('KeyW');
    const t0 = Date.now();
    for (let s = await sample(); Date.now() - t0 < 40_000 && !done(s); s = await sample()) await sleep(100);
    heldUntil = await t(); await page.keyboard.up('KeyW'); return Date.now() - t0;
  };
  /** One crossing's numbers from the page's frames and samples around the first sample past the line */
  const measure = async (/** @type {string} */ name, /** @type {number} */ fromT) => {
    const { frames, samples } = /** @type {{ frames: number[][], samples: any[] }} */ (await page.evaluate(t => { const q = /** @type {any} */ (window).__road; return { frames: q.frames.filter((/** @type {number[]} */ r) => (r[0] ?? 0) >= t), samples: q.samples.filter((/** @type {any} */ r) => r.err === undefined && r.t >= t) }; }, fromT));
    const leaving = name.startsWith('out'), line = samples.find((s, i) => i > 0 && (leaving ? s.inside === null && samples[i - 1].inside !== null : s.inside === home.slug && samples[i - 1].inside !== home.slug));
    if (line === undefined) return { name, crossed: false };
    const window = frames.filter(r => (r[0] ?? 0) >= line.t - 1000 && (r[0] ?? 0) <= line.t + 3000).map(r => r[1] ?? 0), sorted = [...window].sort((a, b) => a - b);
    const cards = samples.filter(s => s.t >= line.t - 1000 && s.t <= line.t + 3000 && s.card !== null);
    // the road bar's stop: ground speed under 90 % of the approach's median, counted only while the key is held
    let stop = 0, worstStop = 0;
    const near = samples.filter(s => s.t >= line.t - 1000 && s.t <= line.t + 3000), held = near.filter(s => s.t <= heldUntil);
    const speed = (/** @type {number} */ i) => Math.hypot(held[i].x - held[i - 1].x, held[i].z - held[i - 1].z) / Math.max(1, held[i].t - held[i - 1].t);
    const approach = held.map((_, i) => i > 0 && held[i].t < line.t - 200 ? speed(i) : NaN).filter(v => Number.isFinite(v)).sort((a, b) => a - b), cruise = approach[Math.floor(approach.length / 2)] ?? 0;
    let stopAt = null;
    for (let i = 1; i < held.length; i++) { stop = speed(i) < cruise * 0.9 ? stop + (held[i].t - held[i - 1].t) : 0; if (stop > worstStop) { worstStop = stop; stopAt = { endsMs: held[i].t - line.t, x: held[i].x, z: held[i].z }; } }
    return { name, crossed: true, lineAt: line.t, frames: window.length, worstFrameMs: sorted.at(-1) ?? 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      over33: window.filter(ms => ms > 33.4).length, over50: window.filter(ms => ms > 50).length, over100: window.filter(ms => ms > 100).length,
      trace: near.filter((_, i) => i % 2 === 0).map(s => [s.t - line.t, s.x, s.z, s.inside, s.cur, s.cx, s.phase, s.card, s.stage, s.res, s.hy, s.hook]), cardMs: cards.length * 50, cards: [...new Set(cards.map(s => `${String(s.card)}:${String(s.stage)}`))], worstStopMs: worstStop, stopAt, cruiseMps: Number((cruise * 1000).toFixed(2)), phases: [...new Set(near.map(s => s.phase))] };
  };
  const t = () => page.evaluate(() => Math.round(performance.now()));
  for (let rep = 1; rep <= reps; rep++) {
    let from = await t();
    await walk(outward, s => s.inside === null && Math.abs(local(s)) >= edge + 12);
    await sleep(2500);
    result.crossings.push({ rep, ...await measure('out (cell to road)', from) });
    from = await t();
    await walk(outward + Math.PI, s => s.inside === home.slug && Math.abs(local(s)) <= edge - 12);
    await sleep(2500);
    result.crossings.push({ rep, ...await measure('back (road to cell)', from) });
    for (const row of result.crossings.slice(-2)) console.log(`${row.crossed === true ? 'ok  ' : 'FAIL'} ${homeName} rep ${String(rep)} ${String(row.name)} ${JSON.stringify({ worst: row.worstFrameMs, p95: row.p95Ms, over50: row.over50, over100: row.over100, card: row.cardMs, stop: row.worstStopMs })}`);
  }
  await page.screenshot({ path: join(out, `${engineName}-${homeName}-road-lag.png`) });
  result.crossingTiming = await page.evaluate(() => /** @type {any} */ (window).__wildshard.shard.grid.state().live?.crossingTiming ?? null);
  await context.close();
  code = result.crossings.every(row => row.crossed === true) && result.errors.length === 0 ? 0 : 1;
} catch (error) { result.note = String(error).slice(0, 400); console.log(`FAIL ${result.note}`); }
finally {
  writeFileSync(join(out, `${engineName}-${homeName}-road-lag.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
process.exit(code);
