import { expect, test } from 'vitest';
import * as v from 'valibot';
import { WaterSchema } from '@wildshard/format/water';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { undrawnWater } from '../src/client/game/shardfile/clientWater';

// CO1: Driftwood's lowered sea is drawn by its client plan's world.water row (its graph ocean); the plain stand-in plane the
// shardfile client drew for the same declared body sat over it and showed through as pale-lavender patches on the phone.
const water = v.parse(WaterSchema, [
  { id: 'pond', kind: 'pool', level: 1, shape: { kind: 'circle', x: 3, z: 4, radius: 5 } },
  { id: 'sea', kind: 'sea', level: 0, waves: true },
]);
const surface = { look: 'ocean-look', name: 'ocean', renderOrder: 4 };

test('a body the plan draws gets no plain plane; every other declared body still does', () => {
  const plan = parseClientPlan({ version: 1, features: [{ kind: 'world.water', rows: [{ id: 'sea', surface, geometry: 'sea.glb' }] }] });
  expect(undrawnWater(water, plan.features).map(body => body.id)).toEqual(['pond']);
  expect(undrawnWater(water, []).map(body => body.id)).toEqual(['pond', 'sea']);
  const both = parseClientPlan({ version: 1, features: [{ kind: 'world.water', rows: [{ id: 'sea', surface, geometry: 'sea.glb' }, { id: 'pond', surface, geometry: 'pond.glb' }] }] });
  expect(undrawnWater(water, both.features)).toEqual([]);
});
