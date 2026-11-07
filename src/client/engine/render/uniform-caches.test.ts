import { expect, test } from 'vitest';
import { installUniformCacheKinds } from './uniformCaches';

interface Leaf { id: string; type: number; cache: unknown[] }
/** a three-shaped program: `getUniforms` builds its tree once (a matrix, a colour, a struct's float, a bool, a sampler) */
function program(): { getUniforms: () => { seq: unknown[] }; built: () => number } {
  let tree: { seq: unknown[] } | undefined, builds = 0;
  return {
    getUniforms() {
      if (tree === undefined) {
        builds++;
        tree = { seq: [{ id: 'modelMatrix', type: 0x8b5c, cache: [] }, { id: 'diffuse', type: 0x8b51, cache: [] },
          { id: 'fog', seq: [{ id: 'density', type: 0x1406, cache: [] }] }, { id: 'flatShading', type: 0x8b56, cache: [] }, { id: 'map', type: 0x8b5e, cache: [] }] };
      }
      return tree;
    },
    built: () => builds,
  };
}
const leaves = (tree: { seq: unknown[] }): Leaf[] => tree.seq.flatMap(node => {
  const seq: unknown = Reflect.get(node as object, 'seq');
  return Array.isArray(seq) ? leaves({ seq }) : [node as Leaf];
});

test('a new program\'s float uniform caches are swapped once, on its first getUniforms; the rest stay three\'s', () => {
  const programs: unknown[] = [], early = program();
  programs.push(early);
  installUniformCacheKinds({ info: { programs } });
  const late = program();
  programs.push(late);
  expect(programs).toEqual([early, late]);
  for (const target of [early, late]) {
    const own = Reflect.get(target, 'getUniforms');
    const first = target.getUniforms(), caches = new Map(leaves(first).map(leaf => [leaf.id, leaf.cache]));
    expect(target.built()).toBe(1);
    // swapped for floats (empty, as three made them), kept for the bool and the sampler; the method is three's again
    for (const leaf of leaves(first)) expect(leaf.cache).toEqual([]);
    expect(Reflect.get(target, 'getUniforms')).not.toBe(own);
    const again = target.getUniforms();
    expect(again).toBe(first);
    expect(new Map(leaves(again).map(leaf => [leaf.id, leaf.cache]))).toEqual(caches);
  }
});

test('a program first used before the install keeps the values its caches hold', () => {
  const programs: unknown[] = [], used = program(), tree = used.getUniforms(), [matrix, colour, density, flat, map] = leaves(tree);
  if (matrix === undefined || colour === undefined || density === undefined || flat === undefined || map === undefined) throw new Error('fixture');
  const values = Array.from({ length: 16 }, (_, i) => i * 0.25 + 0.1);
  matrix.cache.push(...values); colour.cache.push(0.2, 0.4, 0.6); density.cache.push(0.015); flat.cache.push(true); map.cache.push(3);
  const originals = [matrix.cache, colour.cache, density.cache, flat.cache, map.cache];
  programs.push(used);
  installUniformCacheKinds({ info: { programs } });
  const after = leaves(used.getUniforms());
  expect(after.map(leaf => leaf.cache)).toEqual([values, [0.2, 0.4, 0.6], [0.015], [true], [3]]);
  expect(after.map((leaf, i) => leaf.cache === originals[i])).toEqual([false, false, false, true, true]);
  // three keeps writing its own way: a store past the end grows the swapped cache
  after[0]?.cache.splice(0, 16, ...values.map(v => v * 2));
  expect(after[0]?.cache).toEqual(values.map(v => v * 2));
});
