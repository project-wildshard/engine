import { expect, test } from 'vitest';
import * as THREE from 'three';
import { compilePbr } from '../src/client/engine/render/families/pbr';
import { parseFamilyMaterial, type PbrMaterialParams } from '@wildshard/format/materialFamilies';

// Meta SHARD-SOURCE M4.8: a PBR surface's own glow (format 0.5.3 `emissive`, `emissiveIntensity`) reaches three's
// MeshStandardMaterial; absent, the surface does not glow, as before.

function pbr(extra: object): PbrMaterialParams {
  const p = parseFamilyMaterial({ family: 'pbr', ...extra });
  if (p.family !== 'pbr') throw new Error('not pbr');
  return p;
}
const noTextures = (): THREE.Texture => { throw new Error('no textures'); };

test('a plain pbr surface has no glow', () => {
  const m = compilePbr(pbr({}), noTextures);
  expect(m.emissive.getHex()).toBe(0);
  expect(m.emissiveIntensity).toBe(1);
});

test('emissive is sRGB, its intensity defaults to 1', () => {
  const lit = compilePbr(pbr({ emissive: [1, 0.5, 0], emissiveIntensity: 2.6 }), noTextures);
  expect(lit.emissive.getHexString(THREE.SRGBColorSpace)).toBe('ff8000');
  expect(lit.emissiveIntensity).toBe(2.6);
  expect(compilePbr(pbr({ emissive: [1, 0.5, 0] }), noTextures).emissiveIntensity).toBe(1);
});
