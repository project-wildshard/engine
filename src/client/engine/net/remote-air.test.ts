// @vitest-environment happy-dom
// REMOTE-PLAYERS RP9 (Jake, 2026-11-12 17:43: "I need to see them walking ... everything, right? Like, it's an MMO"): another
// player's body jumps and falls as he does. Before RP9 a jump showed as the standing or striding body sliding up and down with
// its row: no tuck on the way up, no arms out on the way down, no dip on landing. RP6's row `air` bit says the player is off
// the ground under his own motion; the row's height gives his vertical speed.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { OtherPlayers } from './otherPlayers';
import { AirPose, LAND_TIME } from './remoteAir';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const Y = column('y'), AIR = column('air'), BOARD = column('board');
const DT = 1 / 60, GRAVITY = 22, JUMP = 7.2;

/** Jimmy at handle 2 standing still; the test sets his height, his `air` (NaN: no data) and whether he rides. */
function jumper(): { client: NetClient; state: { y: number; air: number; board: boolean; mounted: boolean } } {
  const state = { y: 0, air: 0, board: false, mounted: false };
  const entities = new Map([[2, { handle: 2, id: 'player-Jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const riders = { has: (handle: number) => handle === 2 && state.mounted };
  const client = { welcome: { handle: 1 }, entities, riders, interpolator: { sample: (_handle: number, _tick: number, row: Float64Array) => {
    row.fill(0); row[Y] = state.y; row[AIR] = state.air; row[BOARD] = state.board ? 1 : 0; return true;
  } } } as unknown as NetClient;
  return { client, state };
}

interface Look { air: string; thigh: number; shin: number; hands: number; hips: number }
/** What Jake's page draws of Jimmy this frame: his `air` label, the left thigh's lean forward from straight down and the knee's
 *  fold (radians, negative folds back), how far out his hands are (metres, from the body's middle) and how far his hips sit
 *  over his row. */
function look(scene: THREE.Scene, others: OtherPlayers): Look {
  const group = scene.getObjectByName('Player · Jimmy'), figure = group?.getObjectByName('Castaway');
  const thigh = group?.getObjectByName('LeftThigh'), shin = group?.getObjectByName('LeftShin');
  const hands = ['LeftHand', 'RightHand'].map(name => group?.getObjectByName(name));
  if (group === undefined || figure === undefined || thigh === undefined || shin === undefined) throw new Error('no body');
  group.updateMatrixWorld(true);
  const local = (node: THREE.Object3D, at = new THREE.Vector3()): THREE.Vector3 => figure.worldToLocal(node.localToWorld(at.clone()));
  const hip = local(thigh), knee = local(shin), ankle = local(shin, new THREE.Vector3(0, Math.hypot(0.42, 0.02), 0));
  const lean = (from: THREE.Vector3, to: THREE.Vector3): number => Math.atan2(to.z - from.z, from.y - to.y);
  const out = hands.reduce((sum, hand) => sum + (hand === undefined ? 0 : Math.abs(local(hand).x)), 0) / 2;
  const hips = thigh.getWorldPosition(new THREE.Vector3()).y - group.position.y;
  return { air: (others.shown[0] as { air?: string } | undefined)?.air ?? '', thigh: lean(hip, knee), shin: lean(knee, ankle) - lean(hip, knee), hands: out, hips };
}

/** A page with Jimmy on it, settled standing for a second. */
function page(): { scene: THREE.Scene; others: OtherPlayers; scope: Scope; state: ReturnType<typeof jumper>['state']; step: (seconds: number, each?: (at: Look) => void) => void } {
  const scene = new THREE.Scene(), scope = new Scope('rp9-test'), { client, state } = jumper(), others = new OtherPlayers(client, scene, scope);
  const step = (seconds: number, each?: (at: Look) => void): void => { for (let t = 0; t < seconds - 1e-9; t += DT) { others.frame(0, DT); each?.(look(scene, others)); } };
  step(1);
  return { scene, others, scope, state, step };
}

/** Jimmy jumps (or steps off a ledge `drop` metres high with no launch) and lands; every frame's look, with the row's air. */
function flight(launch: number, drop = 0, prepare?: (state: ReturnType<typeof jumper>['state']) => void): { frames: (Look & { rising: boolean; up: boolean })[]; rest: Look } {
  const { scene, others, scope, state, step } = page();
  try {
    prepare?.(state);
    state.y = drop; // standing on the ledge, then the ground goes from under him
    step(0.5);
    const rest = look(scene, others), frames: (Look & { rising: boolean; up: boolean })[] = [];
    let vy = launch;
    for (let t = 0; t < 4; t += DT) {
      const up = state.y > 0 || vy > 0;
      if (up) { vy -= GRAVITY * DT; state.y = Math.max(0, state.y + vy * DT); }
      state.air = state.y > 0 ? (Number.isNaN(state.air) ? Number.NaN : 1) : Number.isNaN(state.air) ? Number.NaN : 0;
      others.frame(0, DT);
      frames.push({ ...look(scene, others), rising: vy > 0.5 && state.y > 0, up: state.y > 0 });
    }
    return { frames, rest };
  } finally { scope.dispose(); }
}

test('going up the legs tuck; coming down the arms go out and the legs reach', () => {
  const { frames, rest } = flight(JUMP);
  const rising = frames.filter(frame => frame.rising).slice(6), falling = frames.filter(frame => frame.up && !frame.rising).slice(6);
  expect(rising.length).toBeGreaterThan(5); expect(falling.length).toBeGreaterThan(5);
  expect(new Set(rising.map(frame => frame.air)), 'rising reads jump').toEqual(new Set(['jump']));
  expect(new Set(falling.map(frame => frame.air)), 'falling reads fall').toEqual(new Set(['fall']));
  const tuck = rising.at(-1), reach = falling.at(-1);
  if (tuck === undefined || reach === undefined) throw new Error('no flight');
  // tucked: the thigh comes up toward level and the knee folds deep, the foot back under it
  expect(tuck.thigh, 'tuck: thigh up').toBeGreaterThan(0.8);
  expect(tuck.shin, 'tuck: knee folded').toBeLessThan(-1.2);
  // falling: the arms are out wider than at rest, the legs reach down (thigh near straight, the knee barely bent)
  expect(reach.hands - rest.hands, 'fall: hands out').toBeGreaterThan(0.25);
  expect(reach.thigh, 'fall: legs reach down').toBeLessThan(0.5);
  expect(reach.shin, 'fall: knee near straight').toBeGreaterThan(-0.6);
  // the tuck is a tuck, the reach is not
  expect(tuck.thigh - reach.thigh).toBeGreaterThan(0.5);
  // never a knee folding forwards
  for (const frame of frames) expect(frame.shin).toBeLessThan(0.05);
});

test('stepping off a ledge reads fall from the start, never jump', () => {
  const { frames } = flight(0, 2);
  const up = frames.filter(frame => frame.up).slice(3);
  expect(up.length).toBeGreaterThan(3);
  expect(up.every(frame => frame.air === 'fall'), up.map(frame => frame.air).join(',')).toBe(true);
});

test('landing dips the hips for a short while, deeper and longer from a higher fall, then stands', () => {
  const dip = (launch: number, drop: number): { depth: number; seconds: number; after: Look; rest: Look } => {
    const { frames, rest } = flight(launch, drop), landed = frames.findIndex((frame, at) => at > 0 && !frame.up);
    const after = frames.slice(landed), landing = after.filter(frame => frame.air === 'land');
    const last = after.at(-1);
    if (last === undefined) throw new Error('no landing');
    expect(after[0]?.air, 'the frame it lands reads land').toBe('land');
    return { depth: rest.hips - Math.min(...landing.map(frame => frame.hips)), seconds: landing.length * DT, after: last, rest };
  };
  const hop = dip(JUMP, 0), off = dip(0, 4);
  expect(hop.depth, 'a jump dips').toBeGreaterThan(0.06);
  expect(hop.seconds, 'a short dip').toBeGreaterThan(0.15);
  expect(hop.seconds).toBeLessThan(0.5);
  expect(Math.abs(hop.seconds - LAND_TIME(JUMP)), 'it lasts LAND_TIME').toBeLessThan(2 * DT);
  expect(off.depth, 'a higher fall dips deeper').toBeGreaterThan(hop.depth);
  expect(off.seconds, 'and for longer').toBeGreaterThan(hop.seconds);
  for (const { after, rest } of [hop, off]) {
    expect(after.air, 'then stands').toBe('');
    expect(Math.abs(after.thigh - rest.thigh)).toBeLessThan(0.02);
    expect(Math.abs(after.hips - rest.hips)).toBeLessThan(0.01);
  }
});

test('a row with no air value draws no air pose, whatever its height does', () => {
  const { frames, rest } = flight(JUMP, 0, state => { state.air = Number.NaN; });
  expect(new Set(frames.map(frame => frame.air))).toEqual(new Set(['']));
  for (const frame of frames) { expect(Math.abs(frame.thigh - rest.thigh)).toBeLessThan(0.02); expect(Math.abs(frame.hands - rest.hands)).toBeLessThan(0.01); }
});

test('a board rider and a mounted rider are left to their own poses (RP8)', () => {
  for (const ride of ['board', 'mounted'] as const) {
    const still = flight(JUMP, 0, state => { state[ride] = true; }), plain = (() => {
      const { scene, others, scope, state, step } = page();
      try { state[ride] = true; step(0.5); return look(scene, others); } finally { scope.dispose(); }
    })();
    expect(new Set(still.frames.map(frame => frame.air)), ride).toEqual(new Set(['']));
    for (const frame of still.frames) expect(Math.abs(frame.thigh - plain.thigh), ride).toBeLessThan(0.02);
  }
});

test('the pose blends in and out instead of snapping', () => {
  const air = new AirPose();
  let y = 0, vy = JUMP, last = 0, biggest = 0;
  air.update(false, 0, DT, false);
  for (let t = 0; t < 1.2; t += DT) {
    vy -= GRAVITY * DT; y = Math.max(0, y + vy * DT);
    air.update(y > 0, y, DT, false);
    biggest = Math.max(biggest, Math.abs(air.weight - last)); last = air.weight;
  }
  expect(biggest, 'weight per frame').toBeLessThan(0.25);
});

test('a tick or two off the ground (a slope, a step) is no landing', () => {
  const air = new AirPose();
  let y = 1;
  for (let at = 0; at < 30; at++) air.update(false, y, DT, false);
  const phases: string[] = [];
  for (let at = 0; at < 3; at++) { y -= 3 * DT; phases.push(air.update(at < 2, y, DT, false)); }
  for (let at = 0; at < 30; at++) phases.push(air.update(false, y, DT, false));
  expect(phases.includes('land'), phases.join(',')).toBe(false);
});
