#!/usr/bin/env node
// REMOTE-PLAYERS RP10 (Jake, 2026-11-12 17:43: "see the health bar going down as Jimmy is smacking it ... it's an MMO"), on the rig
// of `remote-strike-proof.mjs`: two phones in one Driftwood room. Jimmy runs to the nearest creature that fights back (a bear if
// one is in reach) and swings at it; Jake follows a few metres behind, looking at Jimmy, and never swings. Jake's page must draw
// Jimmy's blow as a pale `.other` float, smaller than his own, with the server's number; then, with Jake's hurt pace held (0, so
// the first flash and number stay where they are for the shot), the creature hits Jimmy and Jake's page must report Jimmy's
// body flashed and a red number over him (`__onlinePlayers()` `hurt`), and the shot shows both.
//   WS_RIG_PORTS=18870 scripts/browser-lane.sh --max 15 node scripts/remote-hurt-proof.mjs <app dist stamped with http://127.0.0.1:18873/release.json> <work dir> <key.json> [--shots=<dir>]
import { join } from 'node:path';
import { isMain, runAlone } from './remote-room.mjs';

/** How far behind Jimmy Jake keeps. */
const BEHIND = 5;

/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z }; });
/** @typedef {{ x: number, z: number, away: number, kind: string, aggressive: boolean }} Seen */
/** The live creature Jimmy goes for: the nearest bear, else the nearest that fights back, else the nearest. @param {import('playwright').Page} page @returns {Promise<Seen | null>} */
const quarry = page => page.evaluate(() => {
  const { world } = /** @type {any} */ (window).__wildshard, { player } = world;
  const live = /** @type {any[]} */ (world.animals?.animals ?? []).filter(body => body.alive && body.rowDriven && !body.hidden);
  const away = (/** @type {any} */ body) => Math.hypot(body.position.x - player.position.x, body.position.z - player.position.z);
  live.sort((a, b) => away(a) - away(b));
  const body = live.find(each => each.kind === 'bear' && away(each) < 160) ?? live.find(each => each.aggressive === true) ?? live[0];
  return body === undefined ? null : { x: body.position.x, z: body.position.z, away: away(body), kind: body.kind, aggressive: body.aggressive === true };
});
/** Jimmy goes at a creature and swings in reach. @param {import('playwright').Page} page @param {Seen} body @param {boolean} swing */
const goAt = (page, body, swing) => page.evaluate(([x, z, away, hit]) => {
  const { player, game } = /** @type {any} */ (window).__wildshard.world;
  player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -0.15;
  player.touchMove.y = away > 1.8 ? 1 : 0; player.touchMove.x = 0; player.touchSprint = away > 8;
  if (hit && away < 2.6) game.app.input.press('attack');
}, /** @type {const} */ ([body.x, body.z, body.away, swing]));
/** Jake keeps BEHIND m off Jimmy, on the side he came from, looking at him. @param {import('playwright').Page} page @param {{ x: number, z: number }} him */
const follow = (page, him) => page.evaluate(([x, z, keepOff]) => {
  const { player } = /** @type {any} */ (window).__wildshard.world, dx = x - player.position.x, dz = z - player.position.z, away = Math.hypot(dx, dz);
  player.yaw = Math.atan2(-dx, -dz); player.pitch = -Math.atan2(0.6, Math.max(1, away));
  player.touchMove.y = away > keepOff + 1 ? 1 : 0; player.touchMove.x = 0; player.touchSprint = away > keepOff + 6;
}, /** @type {const} */ ([him.x, him.z, BEHIND]));
/** @param {import('playwright').Page} page */
const stop = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = 0; player.touchMove.x = 0; player.touchSprint = false; });
/** @param {import('playwright').Page} page */
const report = page => page.evaluate(() => (/** @type {any} */ (window)).__workerClient());
/** Jimmy as Jake's page reports him. @param {import('playwright').Page} page */
const jimmyOn = page => page.evaluate(() => ((/** @type {any} */ (window)).__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy') ?? null);
/** On Jake's page, every frame: each damage float as it appears (its number, whose, its size and colour). @param {import('playwright').Page} page */
const watchFloats = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), seen = new Map(), floats = /** @type {any[]} */ ([]);
  w.__rp10 = { floats };
  const tick = () => {
    for (const el of document.querySelectorAll('.ws-combat-float')) {
      const on = el.classList.contains('show'), b = el.querySelector('b'), text = b?.textContent ?? '', key = `${text}|${el.className}`;
      if (!on) { seen.delete(el); continue; }
      if (seen.get(el) === key || b === null) continue;
      seen.set(el, key);
      const style = getComputedStyle(b);
      floats.push({ text, other: el.classList.contains('other'), size: Number.parseFloat(style.fontSize), color: style.color, at: performance.now() });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const PACE = 'wildshard.remoteHurt.pace';

/** @param {import('./remote-room.mjs').Room} room @returns {Promise<string[]>} */
export async function proveHurt({ jake, jimmy, note, shots }) {
  if (jimmy === null) throw new Error('Jimmy is not in the room');
  await watchFloats(jake.page);
  const first = await quarry(jimmy.page);
  note('Jimmy has a creature to fight', first !== null, first);
  if (first === null) throw new Error('no creature on Driftwood');

  // 1. Jimmy swings until a blow lands; Jake, behind him, sees a pale number for it.
  const startHits = (await report(jimmy.page)).hits;
  let landed = false;
  for (let i = 0; i < 400 && !landed; i++) {
    const body = await quarry(jimmy.page);
    if (body === null) { await jimmy.page.waitForTimeout(300); continue; }
    await goAt(jimmy.page, body, true); await follow(jake.page, await where(jimmy.page));
    await jimmy.page.waitForTimeout(250);
    landed = (await report(jimmy.page)).hits > startHits;
  }
  note('Jimmy lands a hit the server takes', landed, { hits: (await report(jimmy.page)).hits });
  let pale = null;
  try { await jake.page.waitForFunction(() => (/** @type {any} */ (window)).__rp10.floats.some((/** @type {any} */ float) => float.other), undefined, { timeout: 4000 }); } catch { /* checked below */ }
  await jake.page.screenshot({ path: join(shots, '1-jake-sees-jimmys-number.png') });
  const floats = await jake.page.evaluate(() => /** @type {any[]} */ ((/** @type {any} */ (window)).__rp10.floats));
  pale = floats.find(float => float.other) ?? null;
  note('Jake\'s page draws Jimmy\'s blow as a pale number, smaller than a page\'s own (22 px on a phone)', pale !== null && /^\d+$/u.test(pale.text) && pale.size < 22 && /rgba\(.*0\.\d+\)/u.test(pale.color), pale);
  note('Jake\'s page draws no number of its own: Jake never swung', floats.every(float => float.other), floats.slice(0, 6));

  // 2. Jake's hurt held at its first frame; Jimmy stays at the creature, not swinging, until it hits him.
  await jake.page.evaluate(key => { /** @type {any} */ (globalThis)[Symbol.for(key)] = 0; }, PACE);
  // the hits Jake's page has routed to Jimmy so far (none in a fresh room; in RP13's room a creature may have bitten him before): this blow is the next
  const before = await jimmyOn(jake.page), earlier = before?.hurt.hits ?? 0;
  note('before this blow, Jake reads no flash on Jimmy', before !== null && before.hurt.flash < 0.05, before?.hurt);
  let hurt = null;
  for (let i = 0; i < 240; i++) {
    const body = await quarry(jimmy.page);
    if (body !== null) await goAt(jimmy.page, body, i % 6 === 0); // a swing now and then keeps it angry
    await follow(jake.page, await where(jimmy.page));
    await jimmy.page.waitForTimeout(250);
    hurt = (await jimmyOn(jake.page))?.hurt ?? null;
    if (hurt !== null && hurt.hits > earlier) break;
  }
  await Promise.all([stop(jimmy.page), stop(jake.page)]);
  await jake.page.waitForTimeout(120);
  await jake.page.screenshot({ path: join(shots, '2-jake-sees-jimmy-hurt.png') });
  hurt = (await jimmyOn(jake.page))?.hurt ?? hurt;
  note('something hits Jimmy, and Jake\'s page routes it to his body', hurt !== null && hurt.hits > earlier, hurt);
  note('Jake sees Jimmy flash (held) and a red number over him', hurt !== null && hurt.flash > 0.9 && hurt.numbers.length > 0 && hurt.numbers[0] === String(hurt.last), hurt);
  await jake.page.evaluate(key => { /** @type {any} */ (globalThis)[Symbol.for(key)] = 1; }, PACE);
  await jake.page.waitForTimeout(1500);
  const after = (await jimmyOn(jake.page))?.hurt ?? null;
  note('let go, the flash and number are gone within a second and a half', after !== null && after.flash < 0.05 || (after !== null && after.hits > (hurt?.hits ?? 0)), after);
  await jimmy.page.screenshot({ path: join(shots, '3-jimmy-own-view.png') });

  return ['1-jake-sees-jimmys-number.png', '2-jake-sees-jimmy-hurt.png', '3-jimmy-own-view.png'];
}

if (isMain(import.meta.url)) await runAlone('remote-hurt', 'rp10', proveHurt);
