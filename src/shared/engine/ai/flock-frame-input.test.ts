import {expect, test, vi} from 'vitest';
import {Vector3} from 'three';
import {FlockBrain} from './flock';
import {onFault, type Fault} from '../core/faults';

function fixture(initialize = true) {
  const height = vi.fn(() => 0), centre = vi.fn<(x: number, y: number, z: number) => void>(), sound = vi.fn<(name: string, x: number, z: number) => void>();
  const brain = new FlockBrain({heightAt: height, normalY: () => 1, inBounds: () => true,
    wetAt: () => false, playerCrouched: () => false, grassHeightAt: () => .5,
    trample: () => undefined, centre},
  {x: 0, z: 0, count: 3, seed: 17, range: 20, runSpeed: 4, walkSpeed: .8, grazeStep: .2, bleatCue: 'sheep'});
  brain.onSound = sound;
  if (initialize) brain.initialize();
  height.mockClear();
  return {brain, height, centre, sound};
}

test('a premature flock frame leaves setup and the first healthy frame intact', () => {
  const f = fixture(false), control = fixture(), before = f.brain.snapshot(), faults: Fault[] = [];
  const off = onFault(fault => {faults.push(fault);}), player = new Vector3();
  try {
    for (let i = 0; i < 2; i++) expect(f.brain.update(1 / 60, 0, player, 0, [])).toBe(false);
    expect(f.brain.snapshot()).toBe(before); expect(f.height).not.toHaveBeenCalled();
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.flock', verdict: 'retry', error: expect.objectContaining({message: 'Flock is not initialized'})});
    f.brain.initialize();
    expect(f.brain.update(1 / 60, 1, player, 0, [])).toBe(control.brain.update(1 / 60, 1, player, 0, []));
    expect(f.brain.snapshot()).toBe(control.brain.snapshot());
    expect(() => f.brain.initialize()).toThrow('Flock already initialized');
  } finally {off();}
});

test.each([
  {dt: Number.NaN, time: 1, speed: 0, message: 'Scheduler dt must be finite and nonnegative'},
  {dt: -1, time: 1, speed: 0, message: 'Scheduler dt must be finite and nonnegative'},
  {dt: Number.POSITIVE_INFINITY, time: 1, speed: 0, message: 'Scheduler dt must be finite and nonnegative'},
  {dt: 1 / 60, time: Number.NaN, speed: 0, message: 'Invalid flock observations'},
  {dt: 1 / 60, time: 1, speed: Number.NaN, message: 'Invalid flock observations'},
  {dt: 1 / 60, time: 1, speed: -1, message: 'Invalid flock observations'},
])('a refused flock observation $message leaves cadence, state and RNG untouched ($dt, $time, $speed)', ({dt, time, speed, message}) => {
  const f = fixture(), control = fixture(), player = new Vector3(), before = f.brain.snapshot(), faults: Fault[] = [];
  const off = onFault(fault => {faults.push(fault);});
  try {
    for (let i = 0; i < 2; i++) expect(f.brain.update(dt, time, player, speed, [])).toBe(false);
    expect(f.brain.snapshot()).toBe(before); expect(f.height).not.toHaveBeenCalled();
    expect(f.centre).not.toHaveBeenCalled(); expect(f.sound).not.toHaveBeenCalled();
    expect(faults).toHaveLength(1); expect(faults[0]).toMatchObject({system: 'ai.flock', verdict: 'retry', error: expect.objectContaining({message})});
    for (let frame = 0; frame < 180; frame++) {
      expect(f.brain.update(1 / 60, frame / 60, player, 0, [])).toBe(control.brain.update(1 / 60, frame / 60, player, 0, []));
    }
    expect(f.brain.snapshot()).toBe(control.brain.snapshot());
    expect(f.centre.mock.calls).toEqual(control.centre.mock.calls); expect(f.sound.mock.calls).toEqual(control.sound.mock.calls);
  } finally {off();}
});

test('flock source, member and continuation APIs still reject invalid direct inputs', () => {
  const f = fixture(), before = f.brain.snapshot();
  expect(() => f.brain.positions(-1, new Vector3())).toThrow('Invalid flock member');
  expect(() => f.brain.restore('{}')).toThrow(); expect(f.brain.snapshot()).toBe(before);
});
