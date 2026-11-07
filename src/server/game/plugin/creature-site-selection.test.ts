import { expect, test } from 'vitest';
import { selectCreatureSites } from './brain';

test('site selection lends stable ranked sites and scores only admitted points in source order', () => {
  const sites = [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 5, z: 0 }, { x: 7, z: 0 }], seen: number[] = [];
  const selected = selectCreatureSites(sites, { count: 2, origin: { x: 0, z: 0 }, minDistance: 2, maxDistance: 7, separation: 4 }, (_p, index) => { seen.push(index); return 1; });
  expect(seen).toEqual([1, 2, 3]); expect(selected.map(row => row.site)).toEqual([sites[1], sites[3]]);
  expect(selected[0]?.site).toBe(sites[1]); // borrow the original owner, never reconstruct its position
  expect(selectCreatureSites(sites, { count: 1 }, () => null)).toEqual([]);
  const actors = sites.map(position => ({ position, alive: position.x !== 1 }));
  const nearest = selectCreatureSites(actors, { count: 1, origin: { x: 0, z: 0 }, maxDistance: 5 }, (actor, _i, distance) => actor.alive ? -distance : null);
  expect(nearest[0]?.site).toBe(actors[1]);
  seen.length = 0;
  const score = (_point: { x: number; z: number }, index: number): number => { seen.push(index); return 1; };
  expect(() => selectCreatureSites(sites, { count: 17 }, score)).toThrow('selection');
  expect(() => selectCreatureSites([...sites, { x: Number.NaN, z: 0 }], { count: 1 }, score)).toThrow('selection');
  expect(() => selectCreatureSites(sites, { count: 1, minDistance: 2 }, score)).toThrow('selection');
  expect(seen).toEqual([]);
  expect(() => selectCreatureSites(sites, { count: 1 }, () => Infinity)).toThrow('score');
});
