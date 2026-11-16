import { afterEach, expect, test, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, NoColorSpace, PlaneGeometry, Texture, TextureLoader } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Scope } from '@wildshard/engine/app/scope';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { realGc } from '@wildshard/engine/test/realGc';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { installTextureUploadEvents, type TextureUploadRenderer } from '@wildshard/engine/render/textureUploadEvents';
import type { BakedTilesRow } from '@wildshard/format/bakedTiles';
import { installBakedTiles } from './bakedTiles';
import { lendLooks } from './lentLooks';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

class DecodedImage {
  readonly width = 512;
  readonly height = 512;
  readonly pixels = new Uint8Array(512 * 512 * 4).fill(73);
}
const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'HTMLImageElement');
afterEach(() => {
  vi.restoreAllMocks();
  if (originalImage === undefined) Reflect.deleteProperty(globalThis, 'HTMLImageElement');
  else Object.defineProperty(globalThis, 'HTMLImageElement', originalImage);
});

const row: BakedTilesRow = {
  id: 'lightmap-fixture', glb: { url: '/assets/lightmap-fixture/ground.glb' },
  tiles: { phone: 'ground_', desktop: 'ground_' }, look: 'lightmap-fixture', drop: 0,
  meshPrefix: 'baked-', sky: false, toonDay: false, sun: null, instances: null,
  lightmaps: ['ao', 'bounceMap'].map(param => ({ param, channel: 0, anisotropy: 4,
    source: { phone: { file: `${param}.png` }, desktop: { file: `${param}.png` } } })),
};

test('baked lightmaps release decoded pixels only after native upload, keeping their live bindings', () =>
  realGc('src/client/game/shardfile/baked-lightmap-lifetime.test.ts', 'baked lightmaps release decoded pixels only', async collect => {
    vi.stubGlobal('HTMLImageElement', DecodedImage);
    const owner = new Scope('lightmap-fixture'), parent = new Group(), material = new MeshBasicMaterial();
    const textures = new Map<string, Texture>(), backings: WeakRef<object>[] = [];
    const file = await new GLTFLoader().parseAsync(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }), '');
    const geometry = new PlaneGeometry(2, 2), tile = new Mesh(geometry, material); tile.name = 'ground_0';
    tile.position.set(2, 3, 4); file.scene.add(tile);
    vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockResolvedValue(file);
    const load = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => {
      const image = new DecodedImage(), texture = new Texture<HTMLImageElement>(); texture.image = legacyDouble<HTMLImageElement>(image);
      backings.push(new WeakRef(image.pixels.buffer)); return Promise.resolve(texture);
    });
    lendLooks(owner, { materials: new Map([[row.look, material]]), bindMeshMap: () => material,
      setParam: () => undefined, setTexture: (_id, name, texture) => { textures.set(name, texture); } });
    const versions = new WeakMap<object, { __version: number }>(), uploaded: number[] = [];
    let complete = false;
    const renderer: TextureUploadRenderer = {
      properties: { get: object => typeof object === 'object' && object !== null ? versions.get(object) : undefined },
      initTexture: texture => {
        renderer.properties.get(texture);
        if (!complete) return;
        const image: unknown = texture.image;
        if (image instanceof DecodedImage) {
          expect(image.pixels.every(value => value === 73)).toBe(true);
          uploaded.push(image.pixels.byteLength);
        }
        texture.onUpdate?.(texture);
        versions.set(texture, { __version: texture.version }); versions.set(texture.source, { __version: texture.source.version });
      },
      render: () => undefined,
    };
    installTextureUploadEvents(renderer);
    try {
      const baked = await installBakedTiles({ product: legacyDouble<ShardFolder>({ url: name => `/lightmap-fixture/${name}` }),
        parent, sky: legacyDouble<SkyRig>({}), registry: legacyDouble<WorldRegistry>({}), scope: owner }, row);
      expect(baked.tiles).toHaveLength(1); expect(baked.group.parent).toBe(parent);
      expect(baked.tiles[0]?.geometry).toBe(geometry); expect(baked.tiles[0]?.matrix.elements.slice(12, 15)).toEqual([2, 3, 4]);
      expect(textures.size).toBe(2); expect(backings).toHaveLength(2);
      load.mockClear();
      for (const texture of textures.values()) {
        expect([texture.flipY, texture.colorSpace, texture.channel, texture.anisotropy]).toEqual([false, NoColorSpace, 0, 4]);
        const hook = vi.fn<(texture: Texture) => void>(); texture.onUpdate = hook;
        renderer.initTexture(texture); expect(texture.image).toBeInstanceOf(DecodedImage); expect(hook).not.toHaveBeenCalled();
        complete = true; renderer.initTexture(texture); complete = false;
        expect(hook).toHaveBeenCalledOnce(); expect(texture.onUpdate).toBe(hook);
        expect(texture.image instanceof DecodedImage).toBe(false);
        const dimensions: unknown = texture.image; expect(dimensions).toEqual({ width: 512, height: 512 });
        expect([texture.flipY, texture.colorSpace, texture.channel, texture.anisotropy]).toEqual([false, NoColorSpace, 0, 4]);
      }
      expect(uploaded).toEqual([1024 * 1024, 1024 * 1024]);
      for (const backing of backings) await collect(backing);
      expect(textures.size).toBe(2); baked.update();
    } finally { owner.dispose();geometry.dispose();material.dispose();for (const texture of textures.values()) texture.dispose(); }
  }));
