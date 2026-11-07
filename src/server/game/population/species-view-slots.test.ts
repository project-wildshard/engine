import { expect, test } from 'vitest';
import { Object3D } from 'three';
import { speciesViewSlots, type SpeciesViewActor } from '../../../client/game/population/speciesViewSlots';

// G600 L7 / L8: every live actor of a kind as a view pool, slots stable per identity
const actor = (id: string, kind = 'balbal'): SpeciesViewActor => ({ entityId: id, kind, mesh: new Object3D(), position: { x: 1, y: 2, z: 3 },
  yaw: 0.5, alive: true, mem: { rise: 0.25 }, attackPhase: -1, scale: 1.5, seed: 7, yOffset: 0 });

test('slots keep their actor through death, free on despawn and reuse the lowest free slot', () => {
  const a = actor('a'), b = actor('b'), c = actor('c'), other = actor('x', 'eagle');
  let live: SpeciesViewActor[] = [a, other, b];
  const slots = speciesViewSlots(() => live, 'balbal', 3, (x, z) => x + z);
  slots.refresh?.();
  expect([0, 1, 2].map(slot => slots.actor(slot)?.identity ?? null)).toEqual(['a', 'b', null]);
  live = [a, b]; Object.assign(a, { alive: false }); slots.refresh?.();
  expect(slots.actor(0)?.identity).toBe('a'); expect(slots.actor(0)?.alive).toBe(false);
  live = [b, c]; slots.refresh?.();
  expect([0, 1, 2].map(slot => slots.actor(slot)?.identity ?? null)).toEqual(['c', 'b', null]);
});

test('fields read memory, then the named actor values, then 0; set writes the height offset only', () => {
  const a = actor('a'), slots = speciesViewSlots(() => [a], 'balbal', 1, () => 9);
  slots.refresh?.();
  const view = slots.actor(0);
  if (view === null) throw new Error('Missing slot');
  expect([view.field('rise'), view.field('scale'), view.field('seed'), view.field('attackPhase'), view.field('absent')]).toEqual([0.25, 1.5, 7, -1, 0]);
  expect([view.field('has:rise'), view.field('has:absent'), view.field('has:scale')]).toEqual([1, 0, 0]);
  expect(view.ground).toBe(9); expect([view.x, view.y, view.z, view.yaw]).toEqual([1, 2, 3, 0.5]);
  view.set('yOffset', 0.4); expect(a.yOffset).toBe(0.4);
  expect(() => { view.set('hp', 1); }).toThrow('not visual');
  expect(speciesViewSlots(() => null, 'balbal', 2, () => 0).actor(0)).toBeNull();
});
