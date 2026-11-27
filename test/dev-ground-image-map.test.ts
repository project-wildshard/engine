// SF22: the dev page (`wildshard dev`) reads the uncooked product, where an images-only zone's ground maps are PNG blobs
// with no cooked KTX2. Its terrain material resolves each one as an image texture: the colour map and the ground layer's
// grain and key-shadow maps, no transcoder asked. (The near sand Dunes lacked there was a spawn under the dunes, held by
// declared-start.test.ts; this holds the image half of the same page.)
import { afterEach, expect, test, vi } from 'vitest';
import { CompressedTexture, Texture } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import * as ktx2 from '../src/client/engine/core/ktx2';
import { Scope } from '../src/shared/engine/app/scope';
import type { Renderer } from '../src/client/engine/render/renderer';
import { emptyShardfile } from '../src/shared/host/author';
import { parseFamilyMaterial } from '@wildshard/format/materialFamilies';
import { clientMaterials } from '../src/client/game/shardfile/clientMaterials';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const PNG = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
const COLOUR = 'a'.repeat(64), GRAIN = 'b'.repeat(64), SHADOW = 'c'.repeat(64);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('an images-only ground material resolves its PNG maps as image textures, with no transcode', async () => {
  const decoded: number[] = [];
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
    decoded.push(new Uint8Array(await blob.arrayBuffer())[8] ?? -1);
    return { width: 4, height: 4, close: () => undefined };
  });
  vi.spyOn(ktx2, 'detectKtx2Support').mockImplementation(loader => loader);
  const transcode = vi.spyOn(KTX2Loader.prototype, 'parse').mockImplementation(() => { throw new Error('an image blob is never transcoded'); });
  const source = emptyShardfile({ slug: 'images-ground', name: 'Images ground', author: 'Test', seed: 1, revision: 1 });
  source.look.materials['ground'] = parseFamilyMaterial({ family: 'pbr', maps: { colour: COLOUR, normal: null, orm: null },
    ground: { grain: { map: GRAIN, mean: 0.5, glintMean: 0, strength: 1 }, keyShadow: { map: SHADOW, rect: [-10, -10, 10, 10], edge: [0.25, 0.75], floor: 0.3 } } });
  source.look.samplers = { [GRAIN]: { wrap: 'repeat', mips: 'gpu', anisotropy: 8 }, [SHADOW]: { filter: 'linear' } };
  const scope = new Scope('images-ground');
  try {
    const result = await clientMaterials(source, new Map([[COLOUR, PNG(1)], [GRAIN, PNG(2)], [SHADOW, PNG(3)]]), legacyDouble<Renderer>({}), scope, { graphs: false });
    expect(transcode).not.toHaveBeenCalled();
    expect(decoded.sort()).toEqual([1, 2, 3]);
    for (const ref of [COLOUR, GRAIN, SHADOW]) {
      const texture = result.textures.get(ref);
      expect(texture).toBeInstanceOf(Texture);
      expect(texture).not.toBeInstanceOf(CompressedTexture);
      expect(texture?.flipY).toBe(false);
    }
    // the grain's `mips: 'gpu'` row builds its chain on the GPU, as a raw KTX2's did
    expect(result.textures.get(GRAIN)?.generateMipmaps).toBe(true);
    const material = result.materials.get('ground');
    expect(material).toHaveProperty('map', result.textures.get(COLOUR));
    const uniforms: unknown = material?.userData['familyUniforms'];
    expect(uniforms).toMatchObject({ famGGrain: { value: result.textures.get(GRAIN) }, famGShadow: { value: result.textures.get(SHADOW) } });
  } finally { scope.dispose(); }
});
