#!/usr/bin/env node
// REMOTE-PLAYERS RP2 (Jake, 2026-11-12 17:43: "Jimmy doesn't have a character model"), on the rig of `remote-bar-proof.mjs`: three
// phones in one Driftwood room. Jake backs off until Jimmy stands 4 m in front of him and Ana beside Jimmy, so two others are in
// view. It fails unless Jake's page draws Jimmy as the castaway body (`__onlinePlayers()` says `modelled` and `castaway`), a body
// 1.75 to 1.85 m tall with its soles within 5 cm of where his row stands, and drawing the two bodies costs Jake's page under 1 ms
// a frame (the scene rendered and finished with them shown, against hidden).
//   scripts/browser-lane.sh --max 15 node scripts/remote-body-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { join } from 'node:path';
import { isMain, runAlone } from './remote-room.mjs';

const AWAY = 4;

/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** Face a spot, the eye tipped down onto a body's middle `away` metres off. @param {import('playwright').Page} page @param {{ x: number, z: number }} at */
const face = (page, at) => page.evaluate(([x, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -Math.atan2(0.75, Math.max(1, away)); }, [at.x, at.z]);
/** @param {import('playwright').Page} page @param {number} forward @param {number} [right] */
const walk = (page, forward, right = 0) => page.evaluate(([y, x]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = x; }, [forward, right]);
/** What Jake's page drew of a named other: its shown row, and the body's measured height and soles against its row. @param {import('playwright').Page} page @param {string} name */
const body = (page, name) => page.evaluate(who => {
  const w = /** @type {any} */ (window), shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === who) ?? null;
  const group = w.__wildshard.world.game.rootScene.getObjectByName(`Player · ${who}`);
  /** @type {any} */ let mesh = null;
  group?.traverse((/** @type {any} */ node) => { if (node.isSkinnedMesh === true) mesh = node; });
  if (group === undefined || mesh === null) return { shown, measured: null };
  group.updateMatrixWorld(true); mesh.computeBoundingBox();
  const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  return { shown, measured: { height: box.max.y - box.min.y, soles: box.min.y - group.position.y, triangles: mesh.geometry.attributes.position.count / 3, contact: group.getObjectByName('GroundContact') !== undefined } };
}, name);
/** Jake's scene drawn and finished `frames` times with the named bodies shown, then hidden: the ms a frame they cost. @param {import('playwright').Page} page @param {string[]} names */
const cost = (page, names) => page.evaluate(({ who, frames }) => {
  const { game } = /** @type {any} */ (window).__wildshard.world, { renderer, rootScene, camera } = game, gl = renderer.getContext();
  const groups = who.map(name => rootScene.getObjectByName(`Player · ${name}`)).filter(Boolean);
  const run = () => { const from = performance.now(); for (let i = 0; i < frames; i++) { renderer.render(rootScene, camera); gl.finish(); } return (performance.now() - from) / frames; };
  const set = (/** @type {boolean} */ shown) => { for (const group of groups) group.visible = shown; };
  run(); // warm the programs
  const samples = { shown: /** @type {number[]} */ ([]), hidden: /** @type {number[]} */ ([]) };
  for (let round = 0; round < 4; round++) { set(true); samples.shown.push(run()); set(false); samples.hidden.push(run()); }
  set(true);
  const median = (/** @type {number[]} */ list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;
  return { bodies: groups.length, shownMs: median(samples.shown), hiddenMs: median(samples.hidden), costMs: median(samples.shown) - median(samples.hidden) };
}, { who: names, frames: 30 });

/** @param {import('./remote-room.mjs').Room} room @returns {Promise<string[]>} */
export async function proveBody({ jake, jimmy, note, shots, enter }) {
  if (jimmy === null) throw new Error('Jimmy is not in the room');
  const ana = await enter('Ana');
  // Jimmy walks on ahead along the way he spawned facing (the pier, so all three stand on one floor) until he is AWAY metres from
  // Jake; Ana follows him a little and steps to his side; then Jimmy turns to Jake, and Jake looks at him.
  let gap = 0;
  for (let i = 0; i < 80; i++) {
    const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
    gap = Math.hypot(me.x - him.x, me.z - him.z);
    if (gap >= AWAY - 0.1) break;
    await walk(jimmy.page, 0.6); await jimmy.page.waitForTimeout(100);
  }
  await walk(jimmy.page, 0);
  // Ana walks to a spot 1.2 m to Jimmy's side, across Jake's line of sight, so both stand in Jake's view.
  const [me, jim] = await Promise.all([where(jake.page), where(jimmy.page)]), spot = { x: jim.x + ((jim.z - me.z) / gap) * 1.2, z: jim.z - ((jim.x - me.x) / gap) * 1.2 };
  for (let i = 0; i < 80; i++) {
    const her = await where(ana.page);
    if (Math.hypot(her.x - spot.x, her.z - spot.z) < 0.35) break;
    await face(ana.page, spot); await walk(ana.page, 0.5); await ana.page.waitForTimeout(100);
  }
  await walk(ana.page, 0);
  /** Turn Jimmy to face Jake, `by` radians further round. @param {number} by */
  const turnJimmy = async by => {
    const at = await where(jake.page);
    return jimmy.page.evaluate(([x, z, more]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.yaw = Math.atan2(x - player.position.x, z - player.position.z) + Math.PI + more; return player.yaw; }, [at.x, at.z, by]);
  };
  const turned = await turnJimmy(0), him = await where(jimmy.page);
  await face(jake.page, him); await jake.page.waitForTimeout(1500);
  note(`Jake stands about ${String(AWAY)} m from Jimmy, on his floor`, gap > AWAY - 0.6 && gap < AWAY + 1.2 && Math.abs((await where(jake.page)).y - him.y) < 0.5, { gap, turned, jimmyYaw: (await where(jimmy.page)).yaw });

  const seen = await body(jake.page, 'Jimmy');
  note('Jake\'s page draws Jimmy as the castaway, not the dummy', seen.shown?.modelled === true && seen.shown.model === 'castaway', seen.shown);
  const measured = seen.measured;
  note('his body stands 1.75 to 1.85 m', measured !== null && measured.height >= 1.75 && measured.height <= 1.85, measured);
  note('his soles are on the ground his row stands on, with a contact under them', measured !== null && Math.abs(measured.soles) <= 0.05 && measured.contact, measured);
  await jake.page.screenshot({ path: join(shots, '1-jake-sees-jimmy-4m.png') });

  // Jimmy turns side-on, then his back: the whole figure from three sides.
  for (const [turn, shot] of /** @type {const} */ ([[Math.PI / 2, '2-jimmy-side-on.png'], [Math.PI, '3-jimmy-from-behind.png']])) {
    await turnJimmy(turn); await jake.page.waitForTimeout(1200); await jake.page.screenshot({ path: join(shots, shot) });
  }
  await turnJimmy(0); await jake.page.waitForTimeout(800);

  const both = await Promise.all([body(jake.page, 'Jimmy'), body(jake.page, 'Ana')]);
  const framed = await jake.page.evaluate(() => {
    const { game } = /** @type {any} */ (window).__wildshard.world, { rootScene, camera } = game, point = camera.position.clone();
    return ['Jimmy', 'Ana'].map(name => { const group = rootScene.getObjectByName(`Player · ${name}`); if (group === undefined) return false; point.copy(group.position); point.y += 1; point.project(camera); return Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && point.z < 1; });
  });
  note('Jimmy and Ana are both in Jake\'s view', framed.every(Boolean), framed);
  const timed = await cost(jake.page, ['Jimmy', 'Ana']);
  note('two castaways in view cost Jake\'s page under 1 ms a frame', both.every(other => other.shown?.model === 'castaway') && timed.bodies === 2 && timed.costMs < 1, timed);
  await jake.page.screenshot({ path: join(shots, '4-jake-sees-two.png') });
  await ana.context.close(); // the room is two pages again
  return ['1-jake-sees-jimmy-4m.png', '2-jimmy-side-on.png', '3-jimmy-from-behind.png', '4-jake-sees-two.png'];
}

if (isMain(import.meta.url)) await runAlone('remote-body', 'rp2', proveBody);
