import {admissionPage} from './fixtures/nalati-admission-loan';
import { expect, test } from 'vitest';

import { Rng } from '../src/shared/engine/core/rng';


const author = () => admissionPage();
test('native alarm decisions retain strict radii and capped awareness', () => {
  const a = author();
  expect(a.project('whistle', { x: 0, z: 0, px: 29, pz: 0, awareness: .9 })).toEqual({ accept: 1, awareness: 1 });
  expect(a.project('whistle', { x: 0, z: 0, px: 30, pz: 0, awareness: 0 })['accept']).toBe(0);
  expect(a.project('scare', { x: 5, z: 5, px: 8, pz: 9, radius: 5 })['accept']).toBe(0);
  expect(a.project('scare', { x: 5, z: 5, px: 8, pz: 9, radius: 6 })['accept']).toBe(1);
});
test('wild speed projection caps teleports and handles a stationary clock', () => {
  const a = author(), row = { x: 100, z: 0, px: 0, pz: 0, dt: .1, speed: 0 };
  expect(a.project('speed', row)['speed']).toBeCloseTo(8.4);
  expect(a.project('speed', { ...row, dt: 0, speed: 3 })['speed']).toBe(3);
  expect(a.project('speed', { ...row, dt: 1 })['speed']).toBe(14);
});
test('raid setup borrows precisely two native stream draws', () => {
  const rng = new Rng(503), expected = new Rng(503), time = 150 + expected.next() * 90; expected.next();
  expect(author().project('firstRaid', {}, rng)['time']).toBe(time);
  expect(rng.snapshot()).toEqual(expected.snapshot());
});
test('owned and stallion damage floors remain bounded at native contact', () => {
  const a = author();
  for (const [owned, stallion, floor] of [[1, 0, .1], [0, 1, .2]] as const) {
    expect(a.project('damage', { owned, stallion, health: floor })['scale']).toBe(0);
    expect(a.project('damage', { owned, stallion, health: 1 })['scale']).toBe(1);
  }
  expect(a.project('damage', { owned: 0, stallion: 0, health: .01 })['scale']).toBe(1);
});
test('dispatch chooses the elite before a group and holds owned horses', () => {
  const a = author(), row = { elite: 0, wolf: 0, dog: 0, held: 0 };
  expect(a.project('dispatch', row)['state']).toBe(4);
  expect(a.project('dispatch', { ...row, held: 1 })['state']).toBe(0);
  expect(a.project('dispatch', { ...row, wolf: 1 })['state']).toBe(2);
  expect(a.project('dispatch', { ...row, dog: 1 })['state']).toBe(3);
  expect(a.project('dispatch', { ...row, elite: 1, wolf: 1 })['state']).toBe(1);
});
test('existing sheepdog decision still fits the unchanged return fuel budget', () => {
  const row = { px: 0, py: 0, pz: 0, cx: 0, cz: 0, dt: .1, bark: 1, rest: 3,
    wolf: 0, distance: 0, wx: 0, wy: 0, wz: 0, straggler: 0, sx: 0, sy: 0, sz: 0, playerX: 0, playerY: 0, playerZ: 0 };
  const a = author();
  expect(a.project('dog', row, new Rng(503))['state']).toBe(0);
  expect(a.project('dog', { ...row, wolf: 1, distance: 1, wx: 3 }, new Rng(503))['state']).toBe(1);
  expect(a.project('dog', { ...row, straggler: 1, sx: 20 }, new Rng(503))['state']).toBe(2);
  for (const [px,pz] of [[3,7],[-12,8],[-4,-9],[8,-3]] as const) {
    const obs={...row,px,pz,rest:0,playerX:2,playerZ:3};
    expect(a.project('dog',obs,new Rng(503))['state']).toBe(3);
    expect(a.project('dog',{...obs,straggler:1,sx:20,sz:13},new Rng(503))['state']).toBe(2);
    expect(a.project('dog',{...obs,rest:3},new Rng(503))['state']).toBe(0);
  }
});
