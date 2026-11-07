// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Color, DataTexture, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, Texture, Vector3, type IUniform } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import * as assets from '@wildshard/engine/core/assets';
import { painterlyUniforms } from '@wildshard/engine/world/painterly';
import { PaintedPanorama } from './painterlyLook';
import { lendLooks } from '../shardfile/lentLooks';

// A made-up dune sea (the panorama's fixture second user): its own painting, haze sea, ridge and lit graphs.
const dunes = { dome: { name: 'dune-sky', look: 'dune-painting', image: { phone: '/assets/dunes/sky.phone.webp', desktop: '/assets/dunes/sky.webp' }, pad: 8, fallbackWidth: 4096,
    zenith: { phone: [0.1, 0.2, 0.4], desktop: [0.1, 0.2, 0.5] }, radius: 1800, segments: [32, 16], order: -80, night: [0, -10],
    params: { image: 'tSky', ridge: 'tRidge', lut: 'tHaze', pad: 'uPad', zenith: 'uZenith', sun: 'uSun', night: 'uNight' } },
  sea: { name: 'haze-sea', look: 'dune-haze', y: -40, lut: 'tHaze', sun: 'uSunView' },
  lit: { looks: ['dune-rock'], shade: 'shade', rim: 'rim', wet: 'wet' } };

afterEach(() => { vi.restoreAllMocks(); });

test('a second shard paints its sky dome and haze sea from its own rows and hears its own uniforms each frame', async () => {
  const scope = new Scope('dune-sea'), scene = new Scene(), params = new Map<string, unknown>(), textures = new Map<string, unknown>();
  lendLooks(scope, { materials: new Map(['dune-painting', 'dune-haze', 'dune-rock'].map(id => [id, new MeshBasicMaterial()])),
    setParam: (id, key, value) => { params.set(`${id}.${key}`, value); }, setTexture: (id, key, value) => { textures.set(`${id}.${key}`, value); },
    bindMeshMap: () => { throw new Error('Unused'); } });
  const image = new Texture(); Object.defineProperty(image, 'image', { value: { width: 800 } });
  const loads = vi.spyOn(assets, 'loadTextureRow').mockResolvedValue(image);
  const old = new MeshBasicMaterial(), sea = new Mesh(new PlaneGeometry(), old); sea.name = 'haze-sea'; scene.add(sea);
  const exposure: IUniform<number> = { value: 1.2 }, tint: IUniform<Color> = { value: new Color(1, 0.5, 0.25) };
  try {
    const panorama = await PaintedPanorama.build(scene, 4, scope, dunes, { ridge: [0.3, 0.4, 0.5, 0.4], lut: new DataTexture(), uniforms: { uExposure: exposure, uTint: tint } });
    if (panorama === null) throw new Error('Missing panorama');
    expect(loads.mock.calls[0]?.[0]).toMatchObject({ url: '/assets/dunes/sky.webp', srgb: true, anisotropy: 4 });
    expect(panorama.dome.name).toBe('dune-sky'); expect(panorama.dome.renderOrder).toBe(-80); expect(scene.getObjectByName('dune-sky')).toBe(panorama.dome);
    expect(params.get('dune-painting.uPad')).toBe(0.01); expect(params.get('dune-painting.uZenith')).toEqual([0.1, 0.2, 0.5]);
    expect(textures.get('dune-painting.tSky')).toBe(image); expect(textures.get('dune-haze.tHaze')).toBeInstanceOf(DataTexture);
    expect(sea.material).not.toBe(old); expect(sea.position.y).toBe(-40);
    painterlyUniforms.uPWet.value = 0.3;
    const night = panorama.update(new Vector3(0, 1, 0), -5);
    expect(night).toBeCloseTo(0.5, 5); expect(params.get('dune-painting.uNight')).toBeCloseTo(0.5, 5);
    expect(params.get('dune-haze.uSunView')).toEqual([0, 1, 0]); expect(params.get('dune-haze.uExposure')).toBe(1.2);
    expect(params.get('dune-painting.uTint')).toEqual([1, 0.5, 0.25]); expect(params.get('dune-rock.wet')).toBe(0.3);
  } finally { scope.dispose(); }
});

test('rows refuse an image outside the assets and a dome with too few segments', async () => {
  const scope = new Scope('dune-refusals'), lut = new DataTexture();
  await expect(PaintedPanorama.build(new Scene(), 1, scope, { ...dunes, dome: { ...dunes.dome, image: { phone: 'sky.webp', desktop: 'sky.webp' } } }, { ridge: [], lut, uniforms: {} })).rejects.toThrow();
  await expect(PaintedPanorama.build(new Scene(), 1, scope, { ...dunes, dome: { ...dunes.dome, segments: [2, 1] } }, { ridge: [], lut, uniforms: {} })).rejects.toThrow();
  scope.dispose();
});
