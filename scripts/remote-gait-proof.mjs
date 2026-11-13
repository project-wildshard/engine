#!/usr/bin/env node
// REMOTE-PLAYERS RP4 (Jake, 2026-11-12 17:43: "I need to see them walking, and I need walking animation"), on the rig of
// `remote-body-proof.mjs`: two phones in one Driftwood room. Jake and Jimmy walk off the pier onto the dry beach; Jake stands and
// Jimmy stands 7 m in front of him, then walks across Jake's view (side-on), then sprints back, then stops. Jake's page must
// read Jimmy `idle`, `walk`, `run`, `idle` in turn; while he moves his legs alternate (each thigh ahead in turn) and every knee
// folds backwards (the shin behind the line of the thigh, never ahead of it); stopped, his legs are back at rest. Captures:
// idle, mid-stride walking, mid-stride running and stopped, each side-on from Jake's page.
//   scripts/browser-lane.sh --max 15 node scripts/remote-gait-proof.mjs <app dist stamped with http://127.0.0.1:18799/release.json> <work dir> <key.json> [--shots=<dir>]
import { join } from 'node:path';
import { isMain, runAlone } from './remote-room.mjs';

/** Jimmy's lane: this far in front of Jake, and this far either side of him. */
const AHEAD = 7, ACROSS = 9;
/** The castaway's thigh and shin lean forward from straight down at rest (castawayBody.ts), radians. */
const THIGH_REST = Math.atan2(0.01, 0.43), SHIN_REST = Math.atan2(-0.02, 0.42);

/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** Face a spot, the eye tipped down onto a body's middle. @param {import('playwright').Page} page @param {{ x: number, z: number }} at */
const face = (page, at) => page.evaluate(([x, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -Math.atan2(0.6, Math.max(1, away)); }, [at.x, at.z]);
/** Push the stick forward (0 lets go), sprinting or not. @param {import('playwright').Page} page @param {number} forward @param {boolean} [sprint] */
const walk = (page, forward, sprint = false) => page.evaluate(([y, run]) => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = run; }, /** @type {const} */ ([forward, sprint]));
/** Walk a page to a spot. @param {import('playwright').Page} page @param {{ x: number, z: number }} spot */
const walkTo = async (page, spot) => {
  for (let i = 0; i < 300; i++) {
    const at = await where(page);
    if (Math.hypot(at.x - spot.x, at.z - spot.z) < 0.4) break;
    await face(page, spot); await walk(page, Math.hypot(at.x - spot.x, at.z - spot.z) < 1.5 ? 0.4 : 1); await page.waitForTimeout(80);
  }
  await walk(page, 0);
};
/** Over `ms` of Jake's frames: Jimmy's gait and speed as `__onlinePlayers()` reads them, and each leg's thigh and shin lean in his
 *  own side view, from his bones. @param {import('playwright').Page} page @param {number} ms */
const watch = (page, ms) => page.evaluate(span => new Promise(resolve => {
  const w = /** @type {any} */ (window), group = w.__wildshard.world.game.rootScene.getObjectByName('Player · Jimmy'), samples = /** @type {any[]} */ ([]);
  const figure = group?.getObjectByName('Castaway'), from = performance.now();
  const lean = (/** @type {string} */ side) => {
    const thigh = group.getObjectByName(`${side}Thigh`), shin = group.getObjectByName(`${side}Shin`), V = thigh.position.constructor;
    const hip = figure.worldToLocal(thigh.getWorldPosition(new V())), knee = figure.worldToLocal(shin.getWorldPosition(new V())), ankle = figure.worldToLocal(shin.localToWorld(new V(0, Math.hypot(0.42, 0.02), 0)));
    return { thigh: Math.atan2(knee.z - hip.z, hip.y - knee.y), shin: Math.atan2(ankle.z - knee.z, knee.y - ankle.y) };
  };
  const tick = () => {
    const shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy');
    if (group !== undefined && figure !== undefined) { group.updateMatrixWorld(true); samples.push({ gait: shown?.gait, speed: shown?.speed, left: lean('Left'), right: lean('Right') }); }
    if (performance.now() - from < span) requestAnimationFrame(tick); else resolve(samples);
  };
  requestAnimationFrame(tick);
}), ms);
/** Wait on Jake's page for Jimmy mid-stride, his thighs at least `spread` radians apart. @param {import('playwright').Page} page @param {number} spread */
const midStride = (page, spread) => page.waitForFunction(apart => {
  const group = /** @type {any} */ (window).__wildshard.world.game.rootScene.getObjectByName('Player · Jimmy'), figure = group?.getObjectByName('Castaway');
  if (figure === undefined) return false;
  group.updateMatrixWorld(true);
  const lean = (/** @type {string} */ side) => {
    const thigh = group.getObjectByName(`${side}Thigh`), shin = group.getObjectByName(`${side}Shin`), V = thigh.position.constructor;
    const hip = figure.worldToLocal(thigh.getWorldPosition(new V())), knee = figure.worldToLocal(shin.getWorldPosition(new V()));
    return Math.atan2(knee.z - hip.z, hip.y - knee.y);
  };
  return Math.abs(lean('Left') - lean('Right')) > apart;
}, spread, { timeout: 4000, polling: 'raf' });
/** Keep a page in its lane: whenever it is past either end and still heading out, it lets go of the stick, so a slow wait on
 *  the other page never walks it off the strip that was checked dry and level. @param {import('playwright').Page} page @param {number} min @param {number} max */
const brake = (page, min, max) => page.evaluate(([low, high]) => {
  const w = /** @type {any} */ (window), { player } = w.__wildshard.world;
  w.__rp4Brake = true;
  const tick = () => { if (w.__rp4Brake !== true) return; const heading = -Math.sin(player.yaw); if ((player.position.x > high && heading > 0) || (player.position.x < low && heading < 0)) { player.touchMove.y = 0; player.touchSprint = false; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}, /** @type {const} */ ([min, max]));
/** What a stretch of samples says of the legs. @param {any[]} samples */
const legs = samples => {
  const sides = samples.flatMap(sample => [sample.left, sample.right]), folds = sides.map(side => side.shin - side.thigh);
  return {
    frames: samples.length, gaits: [...new Set(samples.map(sample => sample.gait))], speed: Math.max(...samples.map(sample => sample.speed ?? 0)),
    leftAhead: samples.filter(sample => sample.left.thigh > sample.right.thigh + 0.2).length, rightAhead: samples.filter(sample => sample.right.thigh > sample.left.thigh + 0.2).length,
    // a fold below 0 is the shin behind the thigh's line, the way a knee bends; the rest pose already folds by SHIN_REST - THIGH_REST
    mostForward: Math.max(...folds), deepest: Math.min(...folds),
  };
};

/** @param {import('./remote-room.mjs').Room} room @returns {Promise<string[]>} */
export async function proveGait({ jake, jimmy, note, shots }) {
  if (jimmy === null) throw new Error('Jimmy is not in the room');
  // Off the pier (spawn faces down it, +z) to the first stretch of dry beach that is dry and level 2 × ACROSS wide at Jimmy's lane.
  const start = await where(jake.page);
  const lane = await jake.page.evaluate(([x, z, ahead, across]) => {
    const { player } = /** @type {any} */ (window).__wildshard.world;
    for (let dz = 30; dz < 90; dz += 1) {
      const heights = []; for (let dx = -across; dx <= across; dx += 1) heights.push(player.groundHeightAt(x + dx, z + dz + ahead));
      const near = player.groundHeightAt(x, z + dz);
      if (near > 0.4 && Math.min(...heights) > 0.4 && Math.max(...heights) - Math.min(...heights) < 0.8) return { dz, low: Math.min(...heights), high: Math.max(...heights) };
    }
    return null;
  }, /** @type {const} */ ([start.x, start.z, AHEAD, ACROSS]));
  if (lane === null) throw new Error('no dry level beach in front of the pier');
  const jakeSpot = { x: start.x, z: start.z + lane.dz }, from = { x: start.x - ACROSS, z: jakeSpot.z + AHEAD }, to = { x: start.x + ACROSS, z: jakeSpot.z + AHEAD };
  await Promise.all([walkTo(jake.page, jakeSpot), walkTo(jimmy.page, from)]);
  await face(jimmy.page, to); await face(jake.page, { x: start.x, z: from.z }); await jake.page.waitForTimeout(1500);
  const [me, him] = await Promise.all([where(jake.page), where(jimmy.page)]);
  note(`Jake on the beach, Jimmy ${String(AHEAD)} m in front at one end of his lane`, Math.abs(him.z - me.z - AHEAD) < 1 && Math.abs(him.x - from.x) < 1, { lane, me, him });

  await brake(jimmy.page, from.x, to.x);
  /** Jake turns to Jimmy and captures. @param {string} shot */
  const capture = async shot => { await face(jake.page, await where(jimmy.page)); await jake.page.screenshot({ path: join(shots, shot) }); };
  // 1. standing
  const standing = legs(await watch(jake.page, 600));
  note('standing, Jake reads Jimmy idle', standing.gaits.length === 1 && standing.gaits[0] === 'idle', standing);
  await capture('1-idle.png');

  // 2. walking across Jake's view, side-on
  await walk(jimmy.page, 1); await jake.page.waitForTimeout(500);
  const walking = legs(await watch(jake.page, 900));
  note('walking, Jake reads Jimmy walk at a walk\'s speed', walking.gaits.length === 1 && walking.gaits[0] === 'walk' && walking.speed > 3.5, walking);
  note('walking, his legs alternate', walking.leftAhead > 3 && walking.rightAhead > 3, walking);
  note('walking, his knees fold backwards, never forwards', walking.mostForward < 0.02 && walking.deepest < -0.4, walking);
  await midStride(jake.page, 0.6); await capture('2-walk-mid-stride.png');
  for (let i = 0; i < 60 && (await where(jimmy.page)).x < to.x - 0.5; i++) { await face(jimmy.page, to); await jimmy.page.waitForTimeout(60); }
  await walk(jimmy.page, 0); await jimmy.page.waitForTimeout(400);

  // 3. sprinting back
  await face(jimmy.page, from); await walk(jimmy.page, 1, true); await jake.page.waitForTimeout(650);
  const running = legs(await watch(jake.page, 600));
  note('sprinting, Jake reads Jimmy run at a sprint\'s speed', running.gaits.includes('run') && running.gaits.every(gait => gait === 'run' || gait === 'walk') && running.speed > 6, running);
  note('running, his legs alternate', running.leftAhead > 2 && running.rightAhead > 2, running);
  note('running, his knees fold backwards, never forwards', running.mostForward < 0.02 && running.deepest < -0.8, running);
  await midStride(jake.page, 0.9); await capture('3-run-mid-stride.png');
  for (let i = 0; i < 60 && (await where(jimmy.page)).x > from.x + 0.5; i++) { await face(jimmy.page, from); await jimmy.page.waitForTimeout(50); }

  // 4. stopped
  await walk(jimmy.page, 0); await jake.page.waitForTimeout(1800);
  const stopped = await watch(jake.page, 400), still = legs(stopped), last = stopped.at(-1);
  const atRest = last !== undefined && [last.left, last.right].every(side => Math.abs(side.thigh - THIGH_REST) < 0.05 && Math.abs(side.shin - SHIN_REST) < 0.05);
  note('stopped, Jake reads Jimmy idle with his legs at rest', still.gaits.length === 1 && still.gaits[0] === 'idle' && atRest, { ...still, last });
  await capture('4-stopped.png');
  await jimmy.page.evaluate(() => { /** @type {any} */ (window).__rp4Brake = false; }); // the brake lets go: the room goes on

  return ['1-idle.png', '2-walk-mid-stride.png', '3-run-mid-stride.png', '4-stopped.png'];
}

if (isMain(import.meta.url)) await runAlone('remote-gait', 'rp4', proveGait);
