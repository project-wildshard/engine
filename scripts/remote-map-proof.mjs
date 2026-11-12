#!/usr/bin/env node
// REMOTE-PLAYERS RP3 (Jake, 2026-11-12 17:46: "we should show other players in the minimap. Like other human players that are
// live in the MMO, they should show on a minimap."), on the rig of `online-proof.mjs` and `remote-bar-proof.mjs`: two phones in one
// Driftwood room. Jake stands facing east; Jimmy walks about 15 m north-east of him. Jake's minimap must show one magenta marker at
// Jimmy's bearing, nosed the way Jimmy faces; Jimmy turns about and walks, and the marker turns and moves; Jimmy's page closes, and
// within 2 s the marker is gone. A dropped link's body stands HOLD_MS (J114: 30 s, cellProtocol.ts) before the server lets it go,
// and the marker is the body's: this rig holds 1 s, so "gone within 2 s" times the minimap, not J114. It reads what the minimap last drew (`othersOnMap`, net/othersOnMap.ts) and the canvas pixel under it.
//   scripts/browser-lane.sh --max 15 node scripts/remote-map-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-map-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-map'), AWAY = 15;
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };
/** An angle into (-π, π]. @param {number} a */
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

process.env.HOLD_MS ??= '1000'; // the rig's server inherits it (main.ts HOLD_MS)
const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @typedef {{ sx: number, sy: number, angle: number, pixel: number[] }} Mark */
/** @typedef {{ marks: Mark[], centre: number, me: { x: number, z: number, yaw: number }, others: { x: number, z: number }[] }} MapSeen */
/** What Jake's minimap last drew of the others, the canvas colour under each, and where the page puts everyone. @param {import('playwright').Page} page @returns {Promise<MapSeen>} */
const mapSeen = page => page.evaluate(() => {
  const shared = /** @type {any} */ (globalThis)[Symbol.for('wildshard.othersOnMap')], { player } = /** @type {any} */ (window).__wildshard.world;
  const canvas = document.querySelector('.ws-minimap-canvas'), pen = canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : null;
  const marks = /** @type {{ sx: number, sy: number, angle: number }[]} */ (shared?.seen ?? []).map(({ sx, sy, angle }) => ({ sx, sy, angle, pixel: pen === null ? [] : [...pen.getImageData(Math.round(sx), Math.round(sy), 1, 1).data] }));
  const others = (/** @type {any} */ (window).__onlinePlayers?.() ?? []).map((/** @type {{ x: number, z: number }} */ body) => ({ x: body.x, z: body.z }));
  return { marks, centre: shared?.centre ?? 0, me: { x: player.position.x, z: player.position.z, yaw: player.yaw }, others };
});
/** Turn to face (x, z), and walk (or stand). @param {import('playwright').Page} page @param {{ x: number, z: number } | null} at @param {boolean} walk */
const head = (page, at, walk) => page.evaluate(([x, z, go]) => {
  const { player } = /** @type {any} */ (window).__wildshard.world;
  if (x !== null && z !== null) player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z));
  player.pitch = -0.1; player.touchMove.y = go ? 1 : 0; player.touchSprint = false;
  return { x: player.position.x, z: player.position.z, yaw: player.yaw };
}, /** @type {[number | null, number | null, boolean]} */ ([at?.x ?? null, at?.z ?? null, walk]));
/** The marker's bearing on screen, clockwise from up (north), and the bearing of `to` from `from` on the map (+Z north, −X east). @param {Mark} mark @param {number} centre */
const screenBearing = (mark, centre) => Math.atan2(mark.sx - centre, -(mark.sy - centre));
/** @param {{ x: number, z: number }} from @param {{ x: number, z: number }} to */
const mapBearing = (from, to) => Math.atan2(-(to.x - from.x), to.z - from.z);
/** The marker's fill is #f05cff (othersOnMap.ts OTHER_FILL): magenta, nothing else on the map is. @param {number[]} p */
const magenta = p => p.length === 4 && Math.abs((p[0] ?? 0) - 0xf0) < 40 && Math.abs((p[1] ?? 0) - 0x5c) < 40 && Math.abs((p[2] ?? 0) - 0xff) < 40;
/** @param {import('playwright').Page} page @param {string} name */
const capture = async (page, name) => { await page.screenshot({ path: join(shots, `${name}.png`) }); await page.locator('.ws-minimap').screenshot({ path: join(shots, `${name}-minimap.png`) }); };
/** Poll Jake's map until `ok` holds. @param {import('playwright').Page} page @param {(seen: MapSeen) => boolean} ok @param {number} ms */
const until = async (page, ok, ms) => { const start = Date.now(); let seen = await mapSeen(page); while (!ok(seen) && Date.now() - start < ms) { await page.waitForTimeout(100); seen = await mapSeen(page); } return { seen, ms: Date.now() - start }; };

let code = 1;
const captured = /** @type {string[]} */ ([]);
try {
  const jake = await enter('Jake');
  // Jake faces east and stands: his own arrow points right, clear of a marker up and to the right.
  const me = await head(jake.page, null, false);
  await jake.page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.player.yaw = Math.PI / 2; });
  await jake.page.waitForTimeout(600);
  const alone = await mapSeen(jake.page);
  note('alone, Jake\'s minimap has no other player', alone.marks.length === 0, alone);

  const jimmy = await enter('Jimmy');
  const first = await until(jake.page, seen => seen.marks.length === 1, 4000);
  note('Jimmy arrives: Jake\'s minimap shows one marker', first.seen.marks.length === 1, first.seen);

  // Jimmy walks to 15 m north-east of Jake (north +Z, east −X).
  const spot = { x: me.x - AWAY * Math.SQRT1_2, z: me.z + AWAY * Math.SQRT1_2 };
  let at = await head(jimmy.page, spot, true), stuck = 0, last = at;
  for (let i = 0; i < 160 && Math.hypot(at.x - spot.x, at.z - spot.z) > 1; i++) {
    await jimmy.page.waitForTimeout(150);
    at = await head(jimmy.page, spot, Math.hypot(at.x - spot.x, at.z - spot.z) > 1);
    stuck = Math.hypot(at.x - last.x, at.z - last.z) < 0.05 ? stuck + 1 : 0; last = at;
    if (stuck === 6) { await jimmy.page.keyboard.press('Space'); stuck = 0; }
  }
  at = await head(jimmy.page, null, false);
  await jake.page.waitForTimeout(900);
  const ne = await mapSeen(jake.page), mark = ne.marks[0], other = ne.others[0];
  const away = other === undefined ? -1 : Math.hypot(other.x - ne.me.x, other.z - ne.me.z);
  note('Jimmy stands about 15 m north-east of Jake', away > 11 && away < 19 && other !== undefined && Math.abs(wrap(mapBearing(ne.me, other) - Math.PI / 4)) < 0.35, { away, bearingDeg: other === undefined ? null : (mapBearing(ne.me, other) * 180) / Math.PI });
  note('the marker sits at Jimmy\'s bearing', mark !== undefined && other !== undefined && Math.abs(wrap(screenBearing(mark, ne.centre) - mapBearing(ne.me, other))) < 0.12,
    { mark, centre: ne.centre, screenDeg: mark === undefined ? null : (screenBearing(mark, ne.centre) * 180) / Math.PI });
  note('the marker is magenta on Jake\'s canvas', mark !== undefined && magenta(mark.pixel), mark?.pixel);
  // A row's yaw is the own arrow's: on screen, clockwise from up, π − yaw.
  note('the marker points the way Jimmy faces', mark !== undefined && Math.abs(wrap(mark.angle - (Math.PI - at.yaw))) < 0.15, { angle: mark?.angle, jimmyYaw: at.yaw });
  await capture(jake.page, '1-jimmy-north-east'); captured.push('1-jimmy-north-east');

  // Jimmy turns about: the marker turns with him.
  await jimmy.page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw += Math.PI; });
  const turned = await until(jake.page, seen => seen.marks[0] !== undefined && mark !== undefined && Math.cos(seen.marks[0].angle - mark.angle) < -0.95, 3000);
  note('Jimmy turns 180°: the marker turns 180°', turned.seen.marks[0] !== undefined && mark !== undefined && Math.cos(turned.seen.marks[0].angle - mark.angle) < -0.95, { before: mark?.angle, after: turned.seen.marks[0]?.angle, ms: turned.ms });
  await capture(jake.page, '2-jimmy-turned'); captured.push('2-jimmy-turned');

  // Jimmy walks back the way he now faces: the marker comes in towards Jake.
  await head(jimmy.page, null, true); await jimmy.page.waitForTimeout(1800); await head(jimmy.page, null, false);
  const moved = await until(jake.page, seen => seen.marks[0] !== undefined && mark !== undefined && Math.hypot(seen.marks[0].sx - mark.sx, seen.marks[0].sy - mark.sy) > 6, 3000);
  const back = moved.seen.marks[0], backOther = moved.seen.others[0];
  note('Jimmy walks: the marker moves, still at his bearing', back !== undefined && mark !== undefined && backOther !== undefined && Math.hypot(back.sx - mark.sx, back.sy - mark.sy) > 6 && Math.abs(wrap(screenBearing(back, moved.seen.centre) - mapBearing(moved.seen.me, backOther))) < 0.2,
    { from: mark, to: back, jimmy: backOther });
  await capture(jake.page, '3-jimmy-walked'); captured.push('3-jimmy-walked');

  // Jimmy's page closes: within 2 s the marker is gone.
  await jimmy.context.close();
  const gone = await until(jake.page, seen => seen.marks.length === 0, 6000);
  note(`Jimmy leaves: the marker is gone within 2 s (body held ${process.env.HOLD_MS} ms)`, gone.seen.marks.length === 0 && gone.seen.others.length === 0 && gone.ms <= 2000, { ms: gone.ms, marks: gone.seen.marks.length, bodies: gone.seen.others.length });
  await capture(jake.page, '4-jimmy-gone'); captured.push('4-jimmy-gone');

  if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const name of captured) for (const end of ['', '-minimap']) copyFileSync(join(shots, `${name}${end}.png`), join(keep, `rp3-${name}${end}.png`)); }
  /** @param {string} line */
  const quiet = line => !/WebSocket connection|ERR_CONNECTION|Failed to load resource/u.test(line), faults = [...jake.errors, ...jimmy.errors].filter(quiet);
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, String(error).slice(0, 400));
} finally {
  await launched.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
