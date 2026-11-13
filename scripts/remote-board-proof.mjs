#!/usr/bin/env node
// REMOTE-PLAYERS RP8 (Jake, 2026-11-12: "hoverboard spinning as he's turning… just everything"), on the rig of
// `remote-body-proof.mjs`: two phones in one Driftwood room. Both walk off the pier onto the sand; Jimmy walks on from Jake, steps on his hoverboard and carves a
// left-hand circle that passes Jake; Jake's page keeps him in frame. It fails unless Jake's page draws the world-scale board
// (about 1.4 m) under Jimmy's feet, banked left into the turn (non-zero while turning) at two points of the circle, coming at
// Jake and going away, and level (|bank| < 0.01 rad) within 0.5 s of Jimmy's drawn yaw going straight.
//   scripts/browser-lane.sh --max 15 node scripts/remote-board-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { enterPage, intoWorld, openRig } from './online-rig.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

const [dist = '', work = '', keyFile = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
if (dist === '' || work === '' || keyFile === '') throw new Error('usage: remote-board-proof.mjs <app dist> <work dir> <key.json> [--shots=<dir>]');
const keep = process.argv.find(value => value.startsWith('--shots='))?.slice('--shots='.length) ?? '';
/** Both walk OFF metres off the pier; Jimmy walks GAP metres on, then carves a circle of RADIUS metres whose near side passes Jake there. */
const SHARD = 'driftwood-isle', shots = join(work, 'shots-remote-board'), OFF = 30, GAP = 5, RADIUS = 6;
mkdirSync(shots, { recursive: true });
const steps = /** @type {{ step: string, ok: boolean }[]} */ ([]);
/** @param {string} step @param {boolean} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };

const rig = await openRig({ dist, work, keyFile, pgBin: 'memory:', pgData: '', shard: SHARD }), url = `${rig.base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const launched = await chromium.launch({ headless: true, args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...phone } = devices['iPhone 16 Pro']; // 402×874
/** @param {string} name */
const enter = async name => { const entered = await enterPage(launched, phone, url, name); await intoWorld(entered.page); return entered; };
/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** @param {import('playwright').Page} page @param {number} forward */
const walk = (page, forward) => page.evaluate(y => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; }, forward);
/** What Jake's page drew of Jimmy's board: its bank, its length, and where his soles and root stand on it. @param {import('playwright').Page} page @returns {Promise<any>} */
const board = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), { player, game } = w.__wildshard.world;
  const shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy') ?? null, group = game.rootScene.getObjectByName('Player · Jimmy');
  const deck = group?.getObjectByName('RemoteHoverboard');
  if (group === undefined || deck === undefined) return { shown, deck: null };
  /** @type {any} */ let mesh = null;
  group.traverse((/** @type {any} */ node) => { if (node.isSkinnedMesh === true) mesh = node; });
  group.updateMatrixWorld(true);
  const corners = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
  deck.traverse((/** @type {any} */ node) => {
    if (node.isMesh !== true) return;
    node.geometry.computeBoundingBox(); const box = node.geometry.boundingBox.clone().applyMatrix4(deck.matrixWorld.clone().invert().multiply(node.matrixWorld)); // in the deck's own axes
    for (const axis of /** @type {const} */ (['x', 'y', 'z'])) { corners.min[axis] = Math.min(corners.min[axis], box.min[axis]); corners.max[axis] = Math.max(corners.max[axis], box.max[axis]); }
  });
  const centre = deck.getWorldPosition(deck.position.clone()), feet = mesh === null ? null : (mesh.computeBoundingBox(), mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  const yaw = group.rotation.y - Math.PI, toJake = Math.atan2(-(player.position.x - group.position.x), -(player.position.z - group.position.z));
  let heading = toJake - yaw; heading = Math.atan2(Math.sin(heading), Math.cos(heading));
  return {
    shown, visible: deck.visible, bank: deck.userData.bank, length: corners.max.z - corners.min.z,
    soles: feet === null ? null : feet.min.y - centre.y, root: group.getObjectByName('Castaway')?.getWorldPosition(deck.position.clone()).distanceTo(centre) ?? null,
    heading, away: Math.hypot(player.position.x - group.position.x, player.position.z - group.position.z),
  };
});

let code = 1;
try {
  const jake = await enter('Jake'), jimmy = await enter('Jimmy');
  // Both walk down the pier onto the sand (OFF metres from spawn), so the carve is over open ground, clear of the pier's posts.
  const start = await where(jake.page);
  for (let i = 0; i < 200; i++) {
    const at = await where(jake.page);
    if (Math.hypot(at.x - start.x, at.z - start.z) >= OFF) break;
    await Promise.all([walk(jake.page, 1), walk(jimmy.page, 1)]); await jake.page.waitForTimeout(100);
  }
  await walk(jake.page, 0);
  // Then Jimmy walks GAP metres on from Jake, and stops.
  let gap = 0;
  for (let i = 0; i < 80; i++) {
    const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
    gap = Math.hypot(me.x - him.x, me.z - him.z);
    if (gap >= GAP - 0.1) break;
    await walk(jimmy.page, 0.6); await jimmy.page.waitForTimeout(100);
  }
  await walk(jimmy.page, 0);
  // Jake keeps Jimmy's drawn body in frame, every frame, the eye tipped onto his middle.
  await jake.page.evaluate(() => {
    const w = /** @type {any} */ (window), { player, game } = w.__wildshard.world;
    const aim = () => { const group = game.rootScene.getObjectByName('Player · Jimmy'); if (group !== undefined) { const dx = group.position.x - player.position.x, dz = group.position.z - player.position.z, away = Math.hypot(dx, dz); player.yaw = Math.atan2(-dx, -dz); player.pitch = -Math.atan2(0.6, Math.max(1, away)); } w.__rp8Aim = requestAnimationFrame(aim); };
    aim();
  });
  // Jimmy steps on his board, Jake on his right, and turns square to the line from Jake (left of his heading is away from Jake).
  const me = await where(jake.page), him = await where(jimmy.page), ux = (him.x - me.x) / gap, uz = (him.z - me.z) / gap;
  await jimmy.page.evaluate(([x, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.setHover(true); player.yaw = Math.atan2(z, -x); }, [ux, uz]);
  await jake.page.waitForTimeout(1200);
  const stepped = await board(jake.page);
  note('Jake\'s page draws Jimmy on his board', stepped.shown?.board === true && stepped.visible === true, stepped);
  note('the board is world scale, about 1.4 m', typeof stepped.length === 'number' && stepped.length > 1.25 && stepped.length < 1.55, { length: stepped.length });
  note('it is under his feet: his root over the deck, his soles on its top', stepped.root !== null && stepped.root < 0.35 && stepped.soles !== null && stepped.soles > 0 && stepped.soles < 0.08, { root: stepped.root, soles: stepped.soles });
  await jake.page.screenshot({ path: join(shots, '1-jimmy-on-board.png') });

  // The carve: forward at a steady stick, the yaw turning left at speed / RADIUS (Jimmy's own speed, read every frame).
  await jimmy.page.evaluate(radius => {
    const w = /** @type {any} */ (window), { player } = w.__wildshard.world;
    let last = performance.now(); w.__rp8Turn = true;
    const carve = () => { const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now; player.touchMove.y = 0.55; player.touchMove.x = 0; if (w.__rp8Turn === true) player.yaw += (Math.hypot(player.velocity.x, player.velocity.z) / radius) * dt; w.__rp8Carve = requestAnimationFrame(carve); };
    carve();
  }, RADIUS);
  /** @type {any[]} */ const banks = [];
  /** @type {Record<string, any>} */ const caught = {};
  for (let i = 0; i < 600 && (caught.toward === undefined || caught.away === undefined); i++) {
    const seen = await board(jake.page);
    if (typeof seen.bank === 'number') banks.push(seen.bank);
    const at = caught.toward === undefined && Math.abs(seen.heading) < 0.3 ? 'toward' : caught.away === undefined && Math.abs(Math.abs(seen.heading) - Math.PI) < 0.3 ? 'away' : '';
    if (at !== '' && banks.length > 20 && seen.visible === true && seen.away < 11) {
      caught[at] = { ...seen, shot: `${at === 'toward' ? '2' : '3'}-carving-${at}.png` };
      await jake.page.screenshot({ path: join(shots, caught[at].shot) });
    }
    await jake.page.waitForTimeout(40);
  }
  for (const at of ['toward', 'away']) {
    const seen = caught[at];
    note(`Jimmy's deck is banked left into the turn, ${at === 'toward' ? 'coming at Jake' : 'going away from him'}`, seen !== undefined && seen.bank > 0.1 && seen.shown?.board === true, seen === undefined ? 'never lined up' : { bank: seen.bank, heading: seen.heading, away: seen.away, speed: seen.shown?.speed });
  }
  const turning = banks.slice(20);
  note('the bank reads non-zero through the carve', turning.length > 10 && Math.min(...turning) > 0.05, { samples: turning.length, min: Math.min(...turning), max: Math.max(...turning) });

  // Straight on: Jimmy stops turning. Jake's page logs his drawn yaw and the bank every frame for 2 s.
  await jake.page.evaluate(() => {
    const w = /** @type {any} */ (window), { game } = w.__wildshard.world, log = /** @type {[number, number, number][]} */ ([]); w.__rp8Log = log;
    const tick = () => { const group = game.rootScene.getObjectByName('Player · Jimmy'), deck = group?.getObjectByName('RemoteHoverboard'); if (deck !== undefined) log.push([performance.now(), group.rotation.y, deck.userData.bank]); if (log.length < 600) requestAnimationFrame(tick); };
    tick();
  });
  await jimmy.page.evaluate(() => { /** @type {any} */ (window).__rp8Turn = false; });
  await jake.page.waitForTimeout(2200);
  const settled = await jake.page.evaluate(() => {
    const log = /** @type {[number, number, number][]} */ (/** @type {any} */ (window).__rp8Log);
    let straight = -1;
    for (let i = 1; i < log.length; i++) { const turn = Math.abs(Math.atan2(Math.sin(log[i][1] - log[i - 1][1]), Math.cos(log[i][1] - log[i - 1][1]))); if (turn > 1e-4) straight = i; }
    if (straight < 0 || straight >= log.length - 1) return { frames: log.length, straight, levelMs: null, endBank: log.at(-1)?.[2] ?? null };
    const level = log.findIndex((entry, i) => i > straight && Math.abs(entry[2]) < 0.01 && log.slice(i).every(rest => Math.abs(rest[2]) < 0.01));
    return { frames: log.length, straight, bankAtStraight: log[straight][2], levelMs: level === -1 ? null : log[level][0] - log[straight][0], endBank: log.at(-1)?.[2] ?? null };
  });
  note('the deck levels (|bank| < 0.01 rad) within 0.5 s of his drawn yaw going straight', settled.levelMs !== null && settled.levelMs <= 500, settled);
  await jake.page.screenshot({ path: join(shots, '4-straight-level.png') });
  await jimmy.page.evaluate(() => { const w = /** @type {any} */ (window); cancelAnimationFrame(w.__rp8Carve); w.__wildshard.world.player.touchMove.y = 0; });
  await jake.page.evaluate(() => { cancelAnimationFrame(/** @type {any} */ (window).__rp8Aim); });

  if (keep !== '') { mkdirSync(keep, { recursive: true }); for (const shot of ['1-jimmy-on-board.png', '2-carving-toward.png', '3-carving-away.png', '4-straight-level.png']) { try { copyFileSync(join(shots, shot), join(keep, `rp8-${shot}`)); } catch { note(`capture ${shot} kept`, false); } } }
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
