import { expect, test } from 'vitest';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { worldSceneSurface } from '../src/sharddev/worldScenes';

test('surface intake hints keep legacy rows byte-compatible and remain closed', () => {
  const original = { id: 'living-door', kind: 'surface', scan: 'authored-wood',
    properties: { roughness: 0.7 }, lookTextures: {} };
  const admitted = worldSceneSurface(original);
  // The default must not add a serialized field to every existing product or
  // opt an external living material into the late-weld scheduler.
  expect(encodeCanonicalJson(admitted)).toBe(encodeCanonicalJson(original));
  expect(Object.hasOwn(admitted, 'load')).toBe(false);
  expect(worldSceneSurface({ ...original, load: 'placement' })).toEqual({ ...admitted, load: 'placement' });
  expect(() => worldSceneSurface({ ...original, load: 'background' })).toThrow();
});
