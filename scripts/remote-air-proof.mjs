#!/usr/bin/env node
// REMOTE-PLAYERS RP9 (Jake, 2026-11-12 17:43: "I need to see them walking ... everything, right? Like, it's an MMO"), on the rig
// of `remote-gait-proof.mjs`: two phones in one Driftwood room. Jimmy steps off the side of the pier while Jake watches from the
// deck, then both go to the dry beach and Jimmy jumps on the sand in front of Jake. Jake's page must read Jimmy `fall` off the
// pier (never `jump`), then `land`, then nothing; on the sand `jump`, `fall`, `land`, then nothing. At each capture Jake's page
// holds its frame (the game's frame gate) on the pose `__onlinePlayers()` reports, reads Jimmy's bones and shoots it: tucked
// going up (a thigh well forward, a knee folded deep), arms out and legs reaching coming down, the hips low in the landing.
//   WS_RIG_PORTS=<base> scripts/browser-lane.sh --max 15 node scripts/remote-air-proof.mjs <app dist stamped with http://127.0.0.1:<base + 3>/release.json> <work dir> <key.json> [--shots=<dir>]
import { join } from 'node:path';
import { isMain, runAlone } from './remote-room.mjs';

/** How far in front of Jake Jimmy jumps on the beach, and how far behind him Jake watches on the pier. */
const AHEAD = 6, BEHIND = 5;
const SHOTS = ['1-pier-fall.png', '2-pier-land.png', '3-sand-jump.png', '4-sand-fall.png'];

/** @param {import('playwright').Page} page @returns {Promise<{ x: number, y: number, z: number, yaw: number }>} */
const where = page => page.evaluate(() => { const { player } = /** @type {any} */ (window).__wildshard.world; return { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw }; });
/** Face a spot, the eye tipped down onto a body's middle. @param {import('playwright').Page} page @param {{ x: number, y?: number, z: number }} at */
const face = (page, at) => page.evaluate(([x, y, z]) => { const { player } = /** @type {any} */ (window).__wildshard.world; const away = Math.hypot(x - player.position.x, z - player.position.z); player.yaw = Math.atan2(-(x - player.position.x), -(z - player.position.z)); player.pitch = -Math.atan2(0.6 + player.position.y - (Number.isNaN(y) ? player.position.y : y), Math.max(1, away)); }, [at.x, at.y ?? Number.NaN, at.z]);
/** Push the stick forward (0 lets go). @param {import('playwright').Page} page @param {number} forward */
const walk = (page, forward) => page.evaluate(y => { const { player } = /** @type {any} */ (window).__wildshard.world; player.touchMove.y = y; player.touchMove.x = 0; player.touchSprint = false; }, forward);
/** Walk a page to a spot. @param {import('playwright').Page} page @param {{ x: number, z: number }} spot */
const walkTo = async (page, spot) => {
  for (let i = 0; i < 300; i++) {
    const at = await where(page);
    if (Math.hypot(at.x - spot.x, at.z - spot.z) < 0.4) break;
    await face(page, spot); await walk(page, Math.hypot(at.x - spot.x, at.z - spot.z) < 1.5 ? 0.4 : 1); await page.waitForTimeout(80);
  }
  await walk(page, 0);
};
/** Jake's page: Jimmy's `air` every frame from now on, into `window.__rp9Airs`. @param {import('playwright').Page} page */
const record = page => page.evaluate(() => {
  const w = /** @type {any} */ (window), airs = /** @type {string[]} */ ([]); w.__rp9Airs = airs; const run = ++w.__rp9Run || (w.__rp9Run = 1);
  const tick = () => { if (w.__rp9Run !== run) return; airs.push((w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy')?.air ?? '?'); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
/** The labels recorded so far, runs of one label folded into one. @param {import('playwright').Page} page @returns {Promise<string[]>} */
const airs = page => page.evaluate(() => /** @type {string[]} */ (/** @type {any} */ (window).__rp9Airs ?? []).filter((air, at, all) => at === 0 || all[at - 1] !== air));
/** Jake's page holds its frame once Jimmy has read `want` for `frames` frames running (the game's frame gate: the canvas keeps
 *  the frame that drew it), and reads his bones in it: the left thigh's lean forward and the knee's fold (radians, negative
 *  folds back), the hands' distance out from his middle and the hips over his row (metres). @param {import('playwright').Page} page @param {string} want @param {number} frames */
const hold = (page, want, frames) => page.evaluate(([label, count]) => new Promise((resolve, reject) => {
  const w = /** @type {any} */ (window), { game } = w.__wildshard.world, from = performance.now();
  let seen = 0;
  const tick = () => {
    const shown = (w.__onlinePlayers?.() ?? []).find((/** @type {any} */ other) => other.name === 'Jimmy');
    seen = shown?.air === label ? seen + 1 : 0;
    if (seen < count) { if (performance.now() - from > 20_000) reject(new Error(`no ${label} in 20 s`)); else requestAnimationFrame(tick); return; }
    const open = game.frameGate; game.frameGate = () => false; w.__rp9Thaw = () => { game.frameGate = open; };
    const group = game.rootScene.getObjectByName('Player · Jimmy'), figure = group.getObjectByName('Castaway'), V = group.position.constructor;
    group.updateMatrixWorld(true);
    const local = (/** @type {any} */ node, at = new V()) => figure.worldToLocal(node.localToWorld(at.clone()));
    const thigh = group.getObjectByName('LeftThigh'), shin = group.getObjectByName('LeftShin');
    const hip = local(thigh), knee = local(shin), ankle = local(shin, new V(0, Math.hypot(0.42, 0.02), 0));
    const lean = (/** @type {any} */ a, /** @type {any} */ b) => Math.atan2(b.z - a.z, a.y - b.y);
    const hands = ['LeftHand', 'RightHand'].map(name => Math.abs(local(group.getObjectByName(name)).x));
    resolve({ air: shown.air, gait: shown.gait, thigh: lean(hip, knee), fold: lean(knee, ankle) - lean(hip, knee), hands: (hands[0] + hands[1]) / 2, hips: thigh.getWorldPosition(new V()).y - group.position.y });
  };
  requestAnimationFrame(tick);
}), /** @type {const} */ ([want, frames]));
/** @param {import('playwright').Page} page */
const thaw = page => page.evaluate(() => { /** @type {any} */ (window).__rp9Thaw?.(); });
/** @param {any} pose */
const round = pose => Object.fromEntries(Object.entries(pose).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value * 100) / 100 : value]));
/** Jake holds on `want`, shoots it and lets go. @param {string} shots @param {import('playwright').Page} page @param {string} want @param {number} frames @param {string} shot */
const capture = async (shots, page, want, frames, shot) => { const pose = await hold(page, want, frames); await page.screenshot({ path: join(shots, shot) }); await thaw(page); return round(pose); };

/** @param {import('./remote-room.mjs').Room} room @returns {Promise<string[]>} */
export async function proveAir({ jake, jimmy, note, shots }) {
  if (jimmy === null) throw new Error('Jimmy is not in the room');
  const start = await where(jake.page);
  // The standing pose's hands and hips, from Jake's page, before anything moves.
  await jimmy.page.waitForTimeout(500);

  // 1. Off the pier. Spawn stands on the deck facing down it (+z) to the beach: the first stretch where the ground a few metres
  // to one side is at most the shallows (a landing, not a swim) and about a metre under the deck. A miss prints the ground.
  const ledge = await jake.page.evaluate(([x, y, z]) => {
    const { player } = /** @type {any} */ (window).__wildshard.world;
    for (let dz = 2; dz < 60; dz += 1) for (const side of [1, -1]) for (const out of [3, 4, 5, 6]) {
      const ground = player.groundHeightAt(x + side * out, z + dz);
      if (ground > -0.3 && y - ground > 0.9) return { dz, side, out, ground, profile: /** @type {string[]} */ ([]) }; // the shallows at most: a landing, not a swim
    }
    const profile = []; for (let dz = 10; dz < 70; dz += 2) profile.push([dz, ...[-6, -3, 0, 3, 6].map(dx => Math.round(player.groundHeightAt(x + dx, z + dz) * 10) / 10)].join(' '));
    return { dz: -1, side: 0, out: 0, ground: y, profile };
  }, /** @type {const} */ ([start.x, start.y, start.z]));
  if (ledge.dz < 0) { console.log(JSON.stringify(ledge, null, 1)); throw new Error('no shallows a metre under the pier'); }
  const edge = { x: start.x, z: start.z + ledge.dz }, watch = { x: start.x, z: edge.z - BEHIND }, off = { x: start.x + ledge.side * (ledge.out + 2), z: edge.z };
  await Promise.all([walkTo(jake.page, watch), walkTo(jimmy.page, edge)]);
  const [onDeck, jimmyDeck] = await Promise.all([where(jake.page), where(jimmy.page)]);
  note('Jake and Jimmy on the pier\'s deck, Jimmy at its side over the shallows', Math.abs(jimmyDeck.y - start.y) < 0.3 && Math.abs(onDeck.y - start.y) < 0.3, { ledge, start, jimmyDeck });
  await face(jake.page, { x: start.x + ledge.side * ledge.out * 0.5, y: (start.y + ledge.ground) / 2, z: edge.z }); await face(jimmy.page, off);
  await jake.page.waitForTimeout(1200);
  const standing = await capture(shots, jake.page, '', 10, '0-standing.png');
  await record(jake.page);
  await walk(jimmy.page, 0.6);
  const pierFall = await capture(shots, jake.page, 'fall', 7, SHOTS[0] ?? '');
  await walk(jimmy.page, 0);
  const pierLand = await capture(shots, jake.page, 'land', 3, SHOTS[1] ?? '');
  await jake.page.waitForTimeout(1500);
  const pierAirs = await airs(jake.page), below = await where(jimmy.page);
  note('off the pier Jake reads Jimmy fall, then land, then nothing; never jump', pierAirs.join(',') === ',fall,land,', { pierAirs, below });
  note('falling, his arms are out and his legs reach down', pierFall.hands - standing.hands > 0.15 && pierFall.thigh < 0.6 && pierFall.fold > -0.7, { standing, pierFall });
  note('landing, his hips dip and his knees fold back', standing.hips - pierLand.hips > 0.03 && pierLand.fold < -0.2, { standing, pierLand });

  // 2. On the beach: the first dry level sand down the pier with room for Jake and Jimmy 6 m apart.
  const here = await where(jimmy.page);
  const lane = await jake.page.evaluate(([x, z, ahead]) => {
    const { player } = /** @type {any} */ (window).__wildshard.world;
    for (let dz = 0; dz < 60; dz += 1) {
      const heights = [0, 1, 2, 3].map(step => player.groundHeightAt(x, z + dz + (step * ahead) / 3));
      if (Math.min(...heights) > 0.4 && Math.max(...heights) - Math.min(...heights) < 0.5) return { dz };
    }
    return null;
  }, /** @type {const} */ ([here.x, here.z, AHEAD]));
  if (lane === null) throw new Error('no dry level beach by the pier');
  const jakeSpot = { x: here.x, z: here.z + lane.dz }, jumpSpot = { x: here.x, z: jakeSpot.z + AHEAD };
  await Promise.all([walkTo(jake.page, jakeSpot), walkTo(jimmy.page, jumpSpot)]);
  const him = await where(jimmy.page);
  await face(jake.page, { ...him, y: him.y + 0.6 }); await jake.page.waitForTimeout(1500);
  await record(jake.page);
  await jimmy.page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.player.touchJump = true; });
  const sandJump = await capture(shots, jake.page, 'jump', 6, SHOTS[2] ?? '');
  await jake.page.waitForTimeout(2000);
  const jumpAirs = await airs(jake.page);
  note('a jump on the sand: Jake reads jump, fall, land, then nothing', jumpAirs.join(',') === ',jump,fall,land,', { jumpAirs });
  note('going up, his legs tuck: the thigh well forward and the knee folded deep', sandJump.thigh > 0.7 && sandJump.fold < -1, { sandJump });
  await record(jake.page);
  await jimmy.page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.player.touchJump = true; });
  const sandFall = await capture(shots, jake.page, 'fall', 6, SHOTS[3] ?? '');
  await jake.page.waitForTimeout(2000);
  note('coming down on the sand, his arms are out and his legs reach', sandFall.hands - standing.hands > 0.15 && sandFall.thigh < sandJump.thigh - 0.3, { sandFall });
  note('the second jump reads the same', (await airs(jake.page)).join(',') === ',jump,fall,land,', await airs(jake.page));

  return ['0-standing.png', ...SHOTS];
}

if (isMain(import.meta.url)) await runAlone('remote-air', 'rp9', proveAir);
