import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { lendRidingPopulation, ridingPopulation, type PageRidingPopulation } from '../src/shared/game/riding/pagePopulation';

// E6 WORLD: a riding page reads its wildlife through this port and nothing else, so the flip swaps one feed.
const population: PageRidingPopulation = { herds: [], mountables: [], predators: [], wind: { x: 0, z: -1, strength: 0 }, wetAt: () => false, rider: () => undefined };

test('a scope reads the population it lent, once it is built', () => {
  const scope = new Scope('riding-port');
  expect(() => ridingPopulation(scope)).toThrow('not installed');
  let built: PageRidingPopulation | null = null;
  lendRidingPopulation(scope, () => built);
  expect(ridingPopulation(scope)).toBeNull();
  built = population;
  expect(ridingPopulation(scope)).toBe(population);
  scope.dispose();
  expect(() => ridingPopulation(scope)).toThrow('disposed');
});
