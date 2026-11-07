import { expect, test } from 'vitest';
import { declaredForestQueries, declaredPondClip } from '../../../client/game/shard/manifest';

const forest = { forest: [
  { x: 1.25, z: -3.5, density: .6, scale: 1.2, species: { spruce: .75, birch: .25 } },
  { x: -8, z: 2, density: .1, scale: .8, species: { willow: 1 } },
] };
const clip = { x0: -2, z0: 4, cell: 0.5, segs: 4, cells: [1, 6] };

test('declared forest queries preserve independent candidate answers from data', () => {
  const query = declaredForestQueries(forest);
  for (const row of forest.forest) {
    expect(query.density(row.x, row.z)).toBe(row.density);
    expect(query.scale(row.x, row.z)).toBe(row.scale);
    expect(query.species(row.x, row.z)).toEqual(row.species);
  }
});

test('an undeclared forest candidate refuses every query instead of guessing', () => {
  const query = declaredForestQueries(forest);
  for (const read of [query.density, query.scale, query.species]) {
    expect(() => read(1.250000000000001, -3.5)).toThrow('Forest candidate differs');
  }
});

test('forest admission refuses non-finite answers and row callbacks', () => {
  const sample = forest.forest[0];
  if (sample === undefined) throw new Error('Missing forest fixture');
  expect(() => declaredForestQueries({ forest: [{ ...sample, density: Number.NaN }] })).toThrow();
  expect(() => declaredForestQueries({ forest: [{ ...sample, species: { spruce: Infinity } }] })).toThrow();
  expect(() => declaredForestQueries({ forest: [{ ...sample, scale: () => 1 }] })).toThrow();
  expect(() => declaredForestQueries({ forest: [{ ...sample, custom: () => 1 }] })).toThrow();
});

test('a declared clip answers by the grid cell a point falls in, listed cells only', () => {
  const accepts = declaredPondClip(clip);
  expect(accepts(-1.25, 4.25)).toBe(true); // cell 1: i 1, j 0
  expect(accepts(-1.5, 4)).toBe(true); // its corner belongs to it
  expect(accepts(-1.001, 4.499)).toBe(true);
  expect(accepts(-1, 4.25)).toBe(false); // cell 2
  expect(accepts(-0.75, 4.75)).toBe(true); // cell 6: i 2, j 1
  expect(accepts(-1.75, 4.25)).toBe(false); // cell 0
  expect(accepts(-2.25, 4.25)).toBe(false); // off the grid's west edge
  expect(accepts(-1.25, 6.25)).toBe(false); // off its north edge
});

test('clip admission refuses fractional cells, an empty grid and non-data extensions', () => {
  expect(() => declaredPondClip({ ...clip, cells: [1.5] })).toThrow();
  expect(() => declaredPondClip({ ...clip, cells: [-1] })).toThrow();
  expect(() => declaredPondClip({ ...clip, segs: 0 })).toThrow();
  expect(() => declaredPondClip({ ...clip, cell: 0 })).toThrow();
  expect(() => declaredPondClip({ ...clip, x0: Infinity })).toThrow();
  expect(() => declaredPondClip({ ...clip, query: () => true })).toThrow();
});
