import { expect, test } from 'vitest';
import * as THREE from 'three';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { SPLAT_LAYER_SIZE, splatArray, splatSurface, type LayerPixels } from '../src/client/game/shardfile/clientSplatLayers';
import { SplatTerrainSchema, splatTextureRefs, type SplatTerrain } from '@wildshard/format/splatTerrain';

// SF24 (J525): an images-only shard (Pine Hollow) carries its splat layers as JPEGs and the cook makes their KTX2. `wildshard
// prepare` records before any cook, so its page has only the decoded images: v0.1.100 and main 29999d8b0 refused them ("its
// four layers must be compressed KTX2") and Pine's phone WebKit prepare stopped on that error card.
const h = (n: number): string => n.toString(16).padStart(64, '0');
const SPLAT: SplatTerrain = v.parse(SplatTerrainSchema, {
  material: 'pine.ground',
  layers: { colour: [h(1), h(2), h(3), h(4)], normal: [h(5), h(6), h(7), h(8)], arm: [h(9), h(10), h(11), h(12)] },
  tints: [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], boreal: null,
});
/** a decoded layer as `imageTexture` makes it: a bitmap-shaped image, unflipped */
const image = (edge: number, fill: number): THREE.Texture => Object.assign(new THREE.Texture({ width: edge, height: edge, fill }), { flipY: false });
/** the canvas read, faked: every texel of a layer is its image's `fill` */
const pixels: LayerPixels = (source, n) => new Uint8ClampedArray(n * n * 4).fill((source as unknown as { fill: number }).fill);
const astc = (): THREE.CompressedTexture => new THREE.CompressedTexture([{ data: new Uint8Array(16), width: 4, height: 4 }], 4, 4, THREE.RGBA_ASTC_4x4_Format);

test('four image layers make one RGBA8 array at the largest edge, layer by layer', () => {
  const t = splatArray('colour', [image(8, 1), image(8, 2), image(4, 3), image(8, 4)], 8, pixels);
  expect(t).toBeInstanceOf(THREE.DataArrayTexture);
  if (!(t instanceof THREE.DataArrayTexture)) return;
  expect([t.image.width, t.image.height, t.image.depth]).toEqual([8, 8, 4]);
  const data = t.image.data as Uint8Array, layer = 8 * 8 * 4;
  expect([0, 1, 2, 3].map(i => data[i * layer])).toEqual([1, 2, 3, 4]);
  expect([t.format, t.type, t.generateMipmaps, t.flipY]).toEqual([THREE.RGBAFormat, THREE.UnsignedByteType, true, false]);
  expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  expect(splatArray('normal', [image(8, 1), image(8, 2), image(8, 3), image(8, 4)], 8, pixels).colorSpace).toBe(THREE.NoColorSpace);
});

test('an image array is capped at the array edge the compressed one uses', () => {
  const t = splatArray('arm', [image(4096, 1), image(2048, 2), image(2048, 3), image(2048, 4)], 8, pixels);
  expect(t.image.width).toBe(SPLAT_LAYER_SIZE);
});

test('a set mixing a compressed and an image layer is still refused', () => {
  expect(() => splatArray('colour', [astc(), image(4, 1), astc(), astc()], 8, pixels)).toThrow('four images');
  expect(() => splatArray('colour', [image(4, 1), new THREE.DataTexture(new Uint8Array(64), 4, 4), image(4, 1), image(4, 1)], 8, pixels)).toThrow('four images');
});

test('compressed layers keep the compressed array', () => {
  expect(splatArray('colour', [astc(), astc(), astc(), astc()])).toBeInstanceOf(THREE.CompressedArrayTexture);
});

test('an images-only splat ground draws its surface from images (no cooked row yet)', () => {
  const scope = new Scope('test.splat-image-layers');
  try {
    const textures = new Map(splatTextureRefs(SPLAT).map((ref, i) => [ref, image(8, i)]));
    const surface = splatSurface(SPLAT, { scope, pixels, texture: ref => { const t = textures.get(ref); if (t === undefined) throw new Error('no layer'); return t; } });
    expect(surface.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(surface.binding.material).toBe(surface.material);
  } finally { scope.dispose(); }
});
