#!/usr/bin/env node
// REMOTE-PLAYERS RP1 (Jake, 2026-11-12 17:43: "I didn't see the health bar of the bear on my side. I would love to see the health
// bar of the bear, see the health bar going down as Jimmy is smacking it"), on the rig of `online-proof.mjs`: two phones in one
// Driftwood room. Jimmy chases the nearest creature and swings until the server takes a hit; Jake stands off to one side, looking
// near it but not at it, so his crosshair never raises its bar. It fails unless Jake's page shows no bar before Jimmy's blow and
// that creature's bar, below full, after it.
//   scripts/browser-lane.sh --max 15 node scripts/remote-bar-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-bar-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-bar');
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 300)}`}`); };

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @typedef {{ x: number, z: number, away: number, kind: string, hp: number, maxHp: number, lastHitT: number, now: number }} Seen */
/** The live creature nearest `to` (or this page's player) on this page. @param {import('playwright').Page} page @param {{ x: number, z: number } | null} to @returns {Promise<Seen | null>} */
const nearest = (page, to) => page.evaluate(spot => {
  const { world } = /** @type {any} */ (window).__wildshard, { player } = world, from = spot ?? { x: player.position.x, z: player.position.z };
  const live = /** @type {any[]} */ (world.animals?.animals ?? []).filter(body => body.alive && body.rowDriven && !body.hidden);
  live.sort((a, b) => Math.hypot(a.position.x - from.x, a.position.z - from.z) - Math.hypot(b.position.x - from.x, b.position.z - from.z));
  const body = live[0];
  return body === undefined ? null : { x: body.position.x, z: body.position.z, away: Math.hypot(body.position.x - player.position.x, body.position.z - player.position.z), kind: body.kind, hp: body.hp, maxHp: body.maxHp, lastHitT: body.lastHitT, now: performance.now() };
}, to);
/** Jake's shown bars: their label and fill. @param {import('playwright').Page} page */
const bars = page => page.evaluate(() => [...document.querySelectorAll('.ws-combat-hp.show')].map(el => ({ kind: el.querySelector('.ws-combat-hp-kind')?.textContent ?? '', fill: /** @type {HTMLElement | null} */ (el.querySelector('.ws-combat-hp-fill'))?.style.transform ?? '' })));
/** Look near a spot, OFF it by `side` radians, so it is on screen but not under the crosshair. @param {import('playwright').Page} page @param {{ x: number, z: number }} at @param {number} side */
const lookNear = (page, at, side) => page.evaluate(([x, z, off]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)) + off; player.pitch = -0.12; player.touchMove.y = 0; }, [at.x, at.z, side]);
/** @param {import('playwright').Page} page */
const report = page => page.evaluate(() => (/** @type {any} */ (window)).__workerClient());

let code = 1;
try {
  const jake = await enter('Jake'), jimmy = await enter('Jimmy');
  const first = await nearest(jimmy.page, null);
  note('Jimmy has a creature to fight', first !== null, first);
  if (first === null) throw new Error('no creature on Driftwood near the spawn');
  // Jake stands back and looks beside it: the bar must not come from his own aim.
  await lookNear(jake.page, first, 0.42); await jake.page.waitForTimeout(800);
  const before = await bars(jake.page), seenBefore = await nearest(jake.page, first);
  note('before Jimmy swings, Jake sees no bar', before.length === 0, { before, seenBefore });
  await jake.page.screenshot({ path: join(shots, '1-jake-before.png') });

  // Jimmy chases and swings, as worker-client-play's fight does: the sword reaches two metres, and a creature doesn't stand still.
  const startHits = (await report(jimmy.page)).hits;
  let landed = false, stuck = 0, from = /** @type {{ x: number, z: number } | null} */ (null), swungAt = /** @type {Seen | null} */ (null);
  for (let i = 0; i < 220 && !landed; i++) {
    const body = await nearest(jimmy.page, null);
    if (body === null) { await jimmy.page.waitForTimeout(400); continue; }
    swungAt = body; // the body this swing went at: a killing blow takes it out of `nearest`
    const at = await jimmy.page.evaluate(([x, z, away, side]) => { const { player, game } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)) + side; player.pitch = -0.15; player.touchMove.y = away > 1.8 ? 1 : 0; player.touchSprint = away > 8; if (away < 2.6) game.app.input.press('attack'); return { x: player.position.x, z: player.position.z }; }, [body.x, body.z, body.away, stuck >= 3 ? (stuck % 12 < 6 ? 1.3 : -1.3) : 0]);
    stuck = from !== null && body.away > 2.6 && Math.hypot(at.x - from.x, at.z - from.z) < 0.4 ? stuck + 1 : Math.max(0, stuck - 1); from = at;
    if (stuck === 4) await jimmy.page.keyboard.press('Space');
    // Jake keeps the fight in view from where he stands, never on his crosshair.
    await lookNear(jake.page, body, 0.42);
    await jimmy.page.waitForTimeout(300);
    landed = (await report(jimmy.page)).hits > startHits;
  }
  await jimmy.page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = 0; player.touchSprint = false; });
  note('Jimmy lands a hit the server takes', landed, { hits: (await report(jimmy.page)).hits });

  const target = swungAt;
  if (target === null) throw new Error('Jimmy never found a creature');
  await lookNear(jake.page, target, 0.42);
  let after = /** @type {Awaited<ReturnType<typeof bars>>} */ ([]), struck = /** @type {Seen | null} */ (null);
  for (let tries = 0; tries < 20 && after.length === 0; tries++) { await jake.page.waitForTimeout(150); after = await bars(jake.page); struck = await nearest(jake.page, target); }
  note('Jake\'s page saw the blow on that creature', struck !== null && struck.hp < struck.maxHp && struck.now - struck.lastHitT < 4000, struck);
  // Combat.ts writes `scaleX(f.toFixed(3))`: below full is any 0.xxx. The bar must carry the struck creature's kind.
  const drained = after.find(bar => /scaleX\(0\.\d+\)/u.test(bar.fill) && struck !== null && bar.kind.replace(/\s+/gu, '').toLowerCase().includes(struck.kind.toLowerCase()));
  note('Jake sees its health bar, below full, though Jimmy struck it', drained !== undefined, after);
  await jake.page.screenshot({ path: join(shots, '2-jake-sees-jimmys-hit.png') });
  await jimmy.page.screenshot({ path: join(shots, '3-jimmy-swinging.png') });
  if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const shot of ['1-jake-before.png', '2-jake-sees-jimmys-hit.png', '3-jimmy-swinging.png']) copyFileSync(join(shots, shot), join(keep, `rp1-${shot}`)); }
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
