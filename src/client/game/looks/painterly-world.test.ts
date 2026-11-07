import { afterEach, expect, test, vi } from 'vitest';
import { Color, DataTexture, Group, HemisphereLight, Mesh, Scene, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { PaintedPanorama } from './painterlyLook';
import { PainterlyWorld } from './postGraphLook';
import type { GrassPresentationProfile } from './grassPresentation';

// The static capture renders on the GPU: the fixture lends one that records what the world asks of it.
const captured = { added: [] as unknown[], sweeps: 0, updates: 0 };
const lent = { staticOffCsm: true, add: (root: unknown) => { captured.added.push(root); }, sweep: () => { captured.sweeps++; }, update: () => { captured.updates++; } };

// A made-up harbour (the painterly world's fixture second user): its own caster groups, sweep, live map and dusk.
const harbour = { casters: ['town', 'rocks', 'missing'], sweep: 1, liveMap: 256, dusk: [10, 0] };
afterEach(() => { vi.restoreAllMocks(); captured.added.length = 0; captured.sweeps = 0; captured.updates = 0; });

function ports() {
  const town = new Group(), rocks = new Group(), boats = new Group(), stars = new Group(), disc = new Mesh(), keys: Vector3[] = [], moods: number[][] = [];
  const shadow = { mapSize: { set: vi.fn() }, map: null }, csm = { shadowMapSize: 2048, lights: [{ shadow, color: new Color(1, 1, 1), intensity: 1 }] };
  const sky = { hemi: new HemisphereLight(), csm, sunDir: new Vector3(0, 1, 0), sunDisc: disc, setKeyLight: (dir: Vector3) => { keys.push(dir.clone()); } } as Pick<SkyRig, 'hemi' | 'setKeyLight' | 'sunDir' | 'sunDisc'> as SkyRig;
  const grass = { uniforms: { uSunView: { value: new Vector3() } }, heightTexture: () => new DataTexture(), mood: (...args: number[]) => { moods.push(args); } } as Pick<GrassPresentationProfile, 'heightTexture' | 'mood'> as GrassPresentationProfile;
  const renderer = { capabilities: { getMaxAnisotropy: () => 4 } } as Pick<Renderer, 'capabilities'> as Renderer;
  return { town, rocks, boats, stars, disc, keys, moods, csm, shadow, grass, renderer, sky };
}
const look = (sunDir: Vector3, moon = 0) => ({ sunDir, keyColor: new Color(), keyIntensity: 1, moon, hemiSky: new Color(), hemiGround: new Color(), hemiIntensity: 1, saturation: 1 });
const key = { turn: 10, lift: 5, ease: [0, 10], sky: [0.5, 0.5, 0.5], ground: [0.2, 0.2, 0.2], mix: 0.5, fill: 1 };

test('a second shard captures its own casters, shrinks the live map and steps its world each frame', async () => {
  const p = ports(), panorama = { dome: new Mesh(), update: vi.fn(() => 0.25) };
  vi.spyOn(PaintedPanorama, 'build').mockResolvedValue(panorama as Pick<PaintedPanorama, 'dome' | 'update'> as PaintedPanorama);
  const world = await PainterlyWorld.build(harbour, { renderer: p.renderer, scene: new Scene(), scope: new Scope('harbour'), sky: p.sky, stars: p.stars,
    groups: { town: p.town, rocks: p.rocks }, casters: [p.boats], grass: p.grass, capture: { lent },
    panorama: { rows: {}, ridge: [], lut: new DataTexture(), uniforms: {} }, key: { rows: key, daySaturation: 1, saturation: { value: 1 } } });
  if (world === null) throw new Error('Missing world');
  expect(captured.added).toEqual([p.town, p.rocks, p.boats]);
  expect(p.csm.shadowMapSize).toBe(256); expect(p.shadow.mapSize.set).toHaveBeenCalledWith(256, 256);
  const sun = new Vector3(0, Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180));
  world.update(0.5, { look: look(sun), sunElevation: 5, overcast: 0.4 });
  world.update(0.6, { look: look(sun), sunElevation: 5, overcast: 0.4 });
  expect(captured.sweeps).toBe(1); expect(captured.updates).toBe(2);   // swept at once, then not again until 1 s has passed
  expect(p.keys).toHaveLength(2); expect(p.grass.uniforms.uSunView.value.toArray()).toEqual(sun.toArray());
  expect(p.moods[0]).toEqual([0.25, 0.5 * 0.75, 0.4]);
  expect(p.stars.visible).toBe(true); expect(p.disc.visible).toBe(false);
});

test('the panorama decides whether the world builds; the rows refuse a tiny live map', async () => {
  const p = ports();
  vi.spyOn(PaintedPanorama, 'build').mockResolvedValue(null);
  const base = { renderer: p.renderer, scene: new Scene(), scope: new Scope('harbour-gone'), sky: p.sky, stars: p.stars, groups: {}, casters: [], grass: p.grass,
    capture: { lent }, panorama: { rows: {}, ridge: [], lut: new DataTexture(), uniforms: {} }, key: { rows: key, daySaturation: 1, saturation: { value: 1 } } };
  expect(await PainterlyWorld.build(harbour, base)).toBeNull();
  await expect(PainterlyWorld.build({ ...harbour, liveMap: 8 }, base)).rejects.toThrow();
});


test('panorama and capture build before a late stars owner is first consumed', async () => {
  const p = ports(), scope = new Scope('harbour-late-stars');
  const panorama = { dome: new Mesh(), update: vi.fn(() => 0.25) };
  const build = vi.spyOn(PaintedPanorama, 'build').mockResolvedValue(panorama as Pick<PaintedPanorama, 'dome' | 'update'> as PaintedPanorama);
  let reads = 0;
  try {
    const world = await PainterlyWorld.build(harbour, { renderer: p.renderer, scene: new Scene(), scope, sky: p.sky,
      get stars() { reads++; return p.stars; }, groups: { town: p.town, rocks: p.rocks }, casters: [p.boats], grass: p.grass,
      capture: { lent }, panorama: { rows: {}, ridge: [], lut: new DataTexture(), uniforms: {} },
      key: { rows: key, daySaturation: 1, saturation: { value: 1 } } });
    if (world === null) throw new Error('Missing world');
    expect(reads).toBe(0); expect(captured.added).toEqual([p.town, p.rocks, p.boats]);
    expect(build).toHaveBeenCalledOnce(); expect(p.csm.shadowMapSize).toBe(256);
    world.update(0.5, { look: look(new Vector3(0, 1, 0)), sunElevation: 5, overcast: 0.4 });
    expect(reads).toBe(1); expect(p.stars.visible).toBe(true); expect(captured.updates).toBe(1);
  } finally { scope.dispose(); }
});
