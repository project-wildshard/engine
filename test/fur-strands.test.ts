import { expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { parseFamilyMaterial, type PbrMaterialParams, type ToonMaterialParams } from '@wildshard/format/materialFamilies';

// ONE-FORMAT OF3c2: a surface's `strands` (format 0.41.2) draws the creature factory's own fur canvases from the same
// numbers: the toon and PBR families take its albedo and relief; a surface without strands is unchanged.
const drawn: unknown[] = [];
vi.mock('../src/client/engine/entities/furCanvases', () => ({
  makeFurCanvases: (seed: number, tex: unknown) => { drawn.push([seed, tex]); return { ca: { width: 512, height: 512 }, cn: { width: 512, height: 512 } }; },
}));
const { compilePbr } = await import('../src/client/engine/render/families/pbr');
const { compileToon, ToonLook } = await import('../src/client/engine/render/families/toon');

const boar = { seed: 202, contrast: 1, grizzle: 0.6, normalStrength: 2.2, bristle: 0.6, strandLen: 12, root: 0.24 };
const pbr = (extra: object): PbrMaterialParams => parseFamilyMaterial({ family: 'pbr', ...extra }) as PbrMaterialParams;
const toon = (extra: object): ToonMaterialParams => parseFamilyMaterial({ family: 'toon', ...extra }) as ToonMaterialParams;
const noTextures = (): THREE.Texture => { throw new Error('no textures'); };

test('a PBR surface with strands draws the factory fur maps once', () => {
  const a = compilePbr(pbr({ strands: boar, vertexColours: true }), noTextures), b = compilePbr(pbr({ strands: boar }), noTextures);
  expect(drawn).toEqual([[202, { contrast: 1, grizzle: 0.6, normalStrength: 2.2, bristle: 0.6, strandLen: 12, root: 0.24 }]]);
  expect(a.map).toBe(b.map); expect(a.normalMap).toBe(b.normalMap);
  expect(a.map?.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(a.map?.wrapS).toBe(THREE.RepeatWrapping);
  expect(a.normalScale.toArray()).toEqual([1, 1]);
});

test('a toon surface with strands takes the same maps', () => {
  const m = compileToon(toon({ strands: boar }), new ToonLook());
  expect(m.map).toBe(compilePbr(pbr({ strands: boar }), noTextures).map);
  expect(m.normalMap).not.toBeNull();
});

test('a surface without strands is unchanged', () => {
  expect(compileToon(toon({}), new ToonLook()).map).toBeNull();
  const plain = compilePbr(pbr({}), noTextures);
  expect(plain.normalScale.toArray()).toEqual([0, 0]);
  expect(drawn).toHaveLength(1);
});
