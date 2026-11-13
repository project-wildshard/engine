// REMOTE-PLAYERS RP8 (Jake, 2026-11-12: "hoverboard spinning as he's turning… just everything"): the board under another
// player. Its deck follows the rider's yaw (the short way round, through the ±π seam), banks into a turn from the yaw rate at
// speed, spins level on the spot, levels within half a second of going straight, and a row's jitter doesn't shake it.
import * as THREE from 'three';
import { expect, test } from 'vitest';
import { castawayBody } from '../models/castawayBody';
import { BANK_MAX, BOARD_LENGTH, BoardUnder, deckAtRest, stepDeck, wrapAngle, type DeckMotion } from './remoteBoard';

const FRAME = 1 / 60;
/** Rides `seconds` at `speed`, the yaw turning at `rate` rad/s (plus `noise(frame)`), from the motion's last yaw. */
function ride(motion: DeckMotion, seconds: number, rate: number, speed: number, noise: (frame: number) => number = () => 0): number[] {
  const banks: number[] = [];
  let yaw = motion.lastYaw ?? 0;
  for (let frame = 0; frame < Math.round(seconds / FRAME); frame++) {
    yaw = wrapAngle(yaw + rate * FRAME);
    stepDeck(motion, wrapAngle(yaw + noise(frame)), speed, FRAME); banks.push(motion.bank);
  }
  motion.lastYaw = yaw;
  return banks;
}
const started = (yaw = 0): DeckMotion => stepDeck(deckAtRest(), yaw, 0, FRAME);

test('the deck follows the rider\'s yaw, the short way through the ±π seam', () => {
  const motion = started();
  stepDeck(motion, 0.6, 0, FRAME);
  expect(motion.deckYaw).toBeGreaterThan(0); expect(motion.deckYaw).toBeLessThan(0.6);
  ride(motion, 0.4, 0, 0);
  expect(motion.deckYaw).toBeCloseTo(0.6, 2);
  const seam = started(3);
  for (let frame = 0; frame < 60; frame++) { ride(seam, FRAME, 1, 6); expect(Math.abs(wrapAngle(seam.deckYaw - (seam.lastYaw ?? 0)))).toBeLessThan(0.1); }
  expect(seam.lastYaw).toBeLessThan(-Math.PI + 1); // crossed the seam
  const snapped = started(0);
  stepDeck(snapped, 2.5, 6, FRAME); // a respawn's turn: the deck jumps with it, no bank
  expect(snapped.deckYaw).toBe(2.5); expect(snapped.bank).toBe(0);
});

test('the bank follows the yaw rate at speed: into a left turn +, a right turn -, level on the spot', () => {
  const left = started();
  ride(left, 1, 0.3, 8);
  expect(left.bank).toBeCloseTo(Math.atan((8 * 0.3) / 9.81), 2);
  ride(left, 1, 1.2, 8);
  expect(left.bank).toBeCloseTo(BANK_MAX, 3);
  const right = started();
  ride(right, 1, -0.4, 8);
  expect(right.bank).toBeCloseTo(-Math.atan((8 * 0.4) / 9.81), 2);
  const spin = started();
  ride(spin, 1, 2, 0);
  expect(spin.bank).toBe(0); expect(spin.yawRate).toBeCloseTo(2, 2);
});

test('going straight levels the deck within half a second', () => {
  const motion = started();
  ride(motion, 1.5, 1.5, 12);
  expect(motion.bank).toBeGreaterThan(0.4);
  const after = ride(motion, 0.5, 0, 12);
  expect(Math.abs(after.at(-1) ?? 1)).toBeLessThan(0.01);
});

test('a row\'s jitter does not shake the deck', () => {
  const motion = started();
  ride(motion, 0.5, 0, 12);
  const yaws: number[] = [];
  const banks = ride(motion, 2, 0, 12, frame => { yaws.push(motion.deckYaw); return frame % 2 === 0 ? 0.004 : -0.004; });
  expect(Math.max(...banks.map(Math.abs))).toBeLessThan(0.02);
  expect(Math.max(...yaws) - Math.min(...yaws)).toBeLessThan(0.004);
});

test('the world-scale deck rolls its left edge down in a left turn, the rider side-on on it, and stands him up off it', () => {
  const body = castawayBody(), under = new BoardUnder(), group = new THREE.Group();
  group.add(under.deck, body.root); under.fit(body.joints);
  const neck = body.joints.neck?.quaternion.clone();
  let yaw = 0;
  for (let frame = 0; frame < 60; frame++) { yaw += FRAME; body.root.position.y = 0.22; under.show(true, yaw, 8, FRAME, body.root, body.joints); }
  group.rotation.y = yaw + Math.PI; group.updateMatrixWorld(true);
  const flat = under.deck.clone(); flat.rotation.set(0, 0, 0); flat.position.set(0, 0, 0); flat.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(flat), length = box.max.z - box.min.z; // along its own nose axis
  expect(under.deck.visible).toBe(true);
  expect(length).toBeGreaterThan(BOARD_LENGTH - 0.15); expect(length).toBeLessThan(BOARD_LENGTH + 0.15);
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(under.deck.quaternion), left = across.x > 0 ? across : across.negate();
  expect(under.motion.bank).toBeGreaterThan(0.3);
  expect(left.y).toBeLessThan(-0.2); // its left edge (+x of the body's group, which faces the rider's way) is the low one
  const chest = new THREE.Vector3(0, 0, 1).applyQuaternion(body.root.quaternion);
  expect(Math.abs(chest.z)).toBeLessThan(0.5); // side-on: the chest faces across the deck, not along it
  expect(body.joints.neck?.quaternion.equals(neck ?? new THREE.Quaternion())).toBe(false);
  under.show(false, yaw, 0, FRAME, body.root, body.joints);
  expect(under.deck.visible).toBe(false);
  expect(body.root.quaternion.equals(new THREE.Quaternion())).toBe(true);
  expect(body.joints.neck?.quaternion.equals(neck ?? new THREE.Quaternion())).toBe(true);
});

test('the rider\'s soles stand on the deck\'s top, not in it or over it', () => {
  const body = castawayBody(), under = new BoardUnder(), group = new THREE.Group();
  group.add(under.deck, body.root); under.fit(body.joints);
  body.root.position.y = 0.22; under.show(true, 0, 0, FRAME, body.root, body.joints); // OtherBody puts a rider's figure at the deck's lift
  group.updateMatrixWorld(true);
  const mesh = body.root.getObjectByName('CastawayBody') as THREE.SkinnedMesh; mesh.computeBoundingBox();
  const soles = (mesh.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(mesh.matrixWorld).min.y, top = under.deck.position.y + 0.034;
  expect(Math.abs(soles - top)).toBeLessThan(0.02);
});
