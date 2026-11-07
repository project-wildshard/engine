import { expect, test } from 'vitest';
import { withFacetedAO } from '../src/sharddev/bake/facetedGeometry';
import { encodeVoxelAOBake, voxelAOBakeStats } from '../src/client/engine/world/voxelAO';

const table = () => encodeVoxelAOBake(new Map([['ba5e2026:feed0010', Float64Array.of(0.25, 0.5)]]));

test('native AO tables are scoped, nested and returned values keep their identity', () => {
  const bytes = table(), before = Uint8Array.from(bytes), entries = voxelAOBakeStats().entries, value = { kind: 'owned geometry' };
  const result = withFacetedAO(bytes, () => {
    expect(voxelAOBakeStats().entries).toBe(entries + 1);
    expect(withFacetedAO(bytes, () => voxelAOBakeStats().entries)).toBe(entries + 1);
    expect(voxelAOBakeStats().entries).toBe(entries + 1);
    return value;
  });
  expect(result).toBe(value);
  expect(voxelAOBakeStats().entries).toBe(entries);
  expect(bytes).toEqual(before);
});

test('AO table ownership drains on the original failure and on a thenable refusal', () => {
  const entries = voxelAOBakeStats().entries, cause = new Error('original author refusal'); let caught: unknown;
  try { withFacetedAO(table(), () => { throw cause; }); } catch (error) { caught = error; }
  expect(caught).toBe(cause);
  expect(voxelAOBakeStats().entries).toBe(entries);
  expect(() => withFacetedAO(table(), () => Promise.resolve(true))).toThrow('must be synchronous');
  expect(voxelAOBakeStats().entries).toBe(entries);
});

test('malformed AO inputs keep the original uncached compilation fallback', () => {
  const entries = voxelAOBakeStats().entries;
  expect(withFacetedAO(new Uint8Array(3), () => voxelAOBakeStats().entries)).toBe(entries);
  expect(voxelAOBakeStats().entries).toBe(entries);
});
