// @vitest-environment happy-dom
// REMOTE-PLAYERS RP4 (Jake, 2026-11-12 17:43: "I need to see them walking, and I need walking animation"): another player's body
// stands, walks and runs by how fast its row moves, blends between them instead of snapping at 0.4 and 5 m/s, plants each foot
// while it carries the body (no foot slide), and folds its knees the way a knee folds: the shin swings back under the thigh.
// Before RP4 the walk was a sine on each thigh with the shin bent by a positive angle, which on the castaway's axes threw the
// foot forward of the knee, and a stance foot slid at almost the body's own speed.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { NetClient } from './client';
import { OtherPlayers } from './otherPlayers';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const Z = column('z'), YAW = column('yaw');
const DT = 1 / 60;
/** The castaway's shin, knee to ankle (castawayBody.ts): the ankle is this far down the shin bone's +y. */
const SHIN = Math.hypot(0.42, 0.02);

/** Jimmy, at handle 2, whose row heads down -z (yaw 0, where he looks) at whatever speed the test sets. */
function walker(): { client: NetClient; motion: { speed: number; z: number } } {
  const motion = { speed: 0, z: 0 };
  const entities = new Map([[2, { handle: 2, id: 'player-Jimmy', cls: PLAYER_CLASS, initial: { name: 'Jimmy' } }]]);
  const client = { welcome: { handle: 1 }, entities, riders: new Map(), interpolator: { sample: (_handle: number, _tick: number, row: Float64Array) => { row.fill(0); row[Z] = motion.z; row[YAW] = 0; return true; } } } as unknown as NetClient;
  return { client, motion };
}

interface Leg { thigh: number; shin: number; ankle: THREE.Vector3 }
/** A leg in the figure's own side view: each bone's lean forward from straight down (radians), and the ankle in the world. */
function leg(group: THREE.Object3D, side: 'Left' | 'Right'): Leg {
  const figure = group.getObjectByName('Castaway'), thigh = group.getObjectByName(`${side}Thigh`), shin = group.getObjectByName(`${side}Shin`);
  if (figure === undefined || thigh === undefined || shin === undefined) throw new Error('no leg');
  group.updateMatrixWorld(true);
  const hip = thigh.getWorldPosition(new THREE.Vector3()), knee = shin.getWorldPosition(new THREE.Vector3()), ankle = shin.localToWorld(new THREE.Vector3(0, SHIN, 0));
  const [h, k, a] = [hip, knee, ankle].map(point => figure.worldToLocal(point.clone())) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  const lean = (from: THREE.Vector3, to: THREE.Vector3): number => Math.atan2(to.z - from.z, from.y - to.y);
  return { thigh: lean(h, k), shin: lean(k, a), ankle };
}

interface Run { gaits: string[]; frames: { left: Leg; right: Leg; bodyZ: number }[] }
/** Jimmy at `speed` m/s for `seconds`, his settle first; each frame's gait and legs after it. */
function stride(speed: number, seconds = 2, settle = 2): Run {
  const scene = new THREE.Scene(), scope = new Scope('rp4-test'), { client, motion } = walker(), others = new OtherPlayers(client, scene, scope);
  const out: Run = { gaits: [], frames: [] };
  try {
    motion.speed = speed;
    for (let t = 0; t < settle + seconds; t += DT) {
      motion.z -= speed * DT;
      others.frame(0, DT);
      if (t < settle) continue;
      const group = scene.getObjectByName('Player · Jimmy');
      if (group === undefined) throw new Error('no body');
      out.gaits.push(others.shown[0]?.gait ?? '');
      out.frames.push({ left: leg(group, 'Left'), right: leg(group, 'Right'), bodyZ: group.position.z });
    }
  } finally { scope.dispose(); }
  return out;
}

test('speed picks the clip: idle standing or creeping, walk at a walk, run at a sprint', () => {
  for (const [speed, gait] of [[0, 'idle'], [0.25, 'idle'], [1.4, 'walk'], [4.3, 'walk'], [7.2, 'run']] as const) {
    expect(new Set(stride(speed, 0.5).gaits), `${String(speed)} m/s`).toEqual(new Set([gait]));
  }
});

test('stopped, the body is idle with its legs at rest', () => {
  const scene = new THREE.Scene(), scope = new Scope('rp4-stop'), { client, motion } = walker(), others = new OtherPlayers(client, scene, scope);
  try {
    const rest = (() => { others.frame(0, DT); const group = scene.getObjectByName('Player · Jimmy'); if (group === undefined) throw new Error('no body'); return [leg(group, 'Left'), leg(group, 'Right')]; })();
    for (let t = 0; t < 2; t += DT) { motion.z -= 4.3 * DT; others.frame(0, DT); }
    for (let t = 0; t < 1.5; t += DT) others.frame(0, DT);
    const group = scene.getObjectByName('Player · Jimmy');
    if (group === undefined) throw new Error('no body');
    expect(others.shown[0]?.gait).toBe('idle');
    const now = [leg(group, 'Left'), leg(group, 'Right')];
    for (const [at, side] of now.entries()) {
      expect(Math.abs(side.thigh - (rest[at]?.thigh ?? 0))).toBeLessThan(0.02);
      expect(Math.abs(side.shin - (rest[at]?.shin ?? 0))).toBeLessThan(0.02);
    }
  } finally { scope.dispose(); }
});

test('the knees fold backwards: the shin swings back under the thigh, never forward, at a walk and a run', () => {
  for (const speed of [1.4, 4.3, 7.2]) {
    let deepest = 0;
    for (const { left, right } of stride(speed).frames) {
      for (const side of [left, right]) {
        const fold = side.shin - side.thigh; // negative: the foot behind the line of the thigh
        expect(fold, `${String(speed)} m/s`).toBeLessThan(0.02);
        deepest = Math.min(deepest, fold);
      }
    }
    expect(deepest, `${String(speed)} m/s bends a knee`).toBeLessThan(-0.4);
  }
});

test('the legs alternate, and a foot on the ground stays put while the body passes over it (cadence matched to speed)', () => {
  for (const speed of [1.4, 4.3, 7.2]) {
    const { frames } = stride(speed);
    // alternate: when one thigh is forward the other is back
    const opposed = frames.filter(({ left, right }) => Math.abs(left.thigh - right.thigh) > 0.1 && Math.sign(left.thigh - right.thigh) !== 0);
    expect(opposed.length / frames.length, `${String(speed)} m/s`).toBeGreaterThan(0.6);
    expect(frames.some(({ left, right }) => left.thigh > right.thigh + 0.2) && frames.some(({ left, right }) => right.thigh > left.thigh + 0.2)).toBe(true);
    // planted: the foot comes down to the ground (its ankle at the rest pose's 8 cm over the soles), and over the frames it is
    // there (within 1 cm of its lowest) it travels under 15 % of the body's travel
    for (const side of ['left', 'right'] as const) {
      const low = Math.min(...frames.map(frame => frame[side].ankle.y));
      expect(Math.abs(low - 0.08), `${String(speed)} m/s ${side} foot reaches the ground`).toBeLessThan(0.015);
      let foot = 0, body = 0;
      for (let at = 1; at < frames.length; at++) {
        const was = frames[at - 1], now = frames[at];
        if (was === undefined || now === undefined || was[side].ankle.y > low + 0.01 || now[side].ankle.y > low + 0.01) continue;
        foot += Math.abs(now[side].ankle.z - was[side].ankle.z); body += Math.abs(now.bodyZ - was.bodyZ);
      }
      expect(body, `${String(speed)} m/s ${side} has a stance`).toBeGreaterThan(0.2);
      expect(foot / body, `${String(speed)} m/s ${side} foot slide`).toBeLessThan(0.15);
    }
  }
});

test('walk blends into run: no snap in the stride across 5 m/s', () => {
  // the thigh's swing, the knee's fold and the swinging foot's lift, each at its peak over a stride
  const peaks = (speed: number): number[] => { const { frames } = stride(speed); return [Math.max(...frames.map(({ left }) => Math.abs(left.thigh))), Math.min(...frames.map(({ left }) => left.shin - left.thigh)), Math.max(...frames.map(({ left }) => left.ankle.y))]; };
  const below = peaks(4.9), above = peaks(5.1);
  const [thigh = 0, fold = 0, lift = 0] = below;
  expect(Math.abs((above[0] ?? 0) - thigh) / thigh, 'thigh swing').toBeLessThan(0.1);
  expect(Math.abs((above[1] ?? 0) - fold) / Math.abs(fold), 'knee fold').toBeLessThan(0.1);
  expect(Math.abs((above[2] ?? 0) - lift), 'foot lift, metres').toBeLessThan(0.03);
});
