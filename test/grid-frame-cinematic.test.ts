// Meta QA 11-25 row 110: the region cinematic install (the volumetric march, and god rays with their blur and copies) is
// placed in the shell's colour pass only where a cell of the world can carry it on this tier. A one-cell world of a
// clean-chain zone with its god rays off places none of it, so none of its programs link; a world with a cinematic cell
// still has it placed at install, before any crossing, and a crossing recompiles nothing.
import { expect, test, vi } from 'vitest';
import { BrightnessContrastEffect, EffectPass, GodRaysEffect, HueSaturationEffect, type Effect, type EffectComposer } from 'postprocessing';
import { Mesh, PerspectiveCamera, Scene } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { GradeEffect } from '@wildshard/engine/core/Grade';
import { TIER_CONFIG } from '@wildshard/engine/core/tier';
import { RegionCinematic } from '../src/client/engine/render/regionCinematic';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { GridFrame, passEffects } from '../src/client/game/grid/frame';
import { catalogueCarriage, type CellCarriage, type RegionChain } from '../src/client/game/grid/frameLook';

const grade = { saturation: 0, brightness: 0, contrast: 0, shadowTint: [1, 1, 1], highTint: [1, 1, 1], lift: [0, 0, 0], gain: [1, 1, 1], gamma: 1 } as const;
const cinematicChain: RegionChain = { grade, look: { curve: 0, vibrance: 0 }, lut: () => null,
  post: { kind: 'cinematic', bloomIntensity: 0, bloomThreshold: 1, bloomSmoothing: 1, vignette: 0, rays: 1, ao: false, volumetric: { strength: .5, sunColor: [1, 1, 1] } } };
// Brasscap's and the open plots' chain on a phone: clean, god rays off
const cleanChain: RegionChain = { grade, look: { curve: 0, vibrance: 0 }, lut: () => null,
  post: { kind: 'clean', bloomIntensity: 0, bloomThreshold: 1, bloomSmoothing: .08, vignette: .35, rays: 0, ao: false } };

/** A phone shell page (its chain leaves its god rays out) with one or two cells, the cinematic install counted. */
function world(carriage: readonly CellCarriage[] | undefined, cells = 1) {
  const scope = new Scope('cinematic-placement'), scene = new Scene(), camera = new PerspectiveCamera();
  const saturation = new HueSaturationEffect(), contrast = new BrightnessContrastEffect(), gradeEffect = new GradeEffect();
  const pass = new EffectPass(camera, saturation, contrast, gradeEffect);
  const composer = legacyDouble<EffectComposer>({ passes: [pass] });
  const cinematic = new RegionCinematic(camera, null, TIER_CONFIG, new GodRaysEffect(camera, new Mesh()));
  const warm = vi.spyOn(cinematic, 'warm'), recompile = vi.spyOn(pass, 'recompile');
  const home = { instance: 'home', origin: { x: 0, z: 0 } }, next = { instance: 'next', origin: { x: 500, z: 0 } };
  const feet = { x: 0, z: 0 };
  const frame = new GridFrame({ scope, host: { scene, camera, composer: () => composer, post: () => ({ saturation, contrast, grade: gradeEffect, rays: null }), cinematic: () => cinematic },
    cells: cells === 1 ? [home] : [home, next], home, homeIsFrame: false, half: 250, feet: () => feet, ...(carriage === undefined ? {} : { carriage: () => carriage }) });
  const install: readonly Effect[] = [cinematic.vol, cinematic.chroma, cinematic.grain, ...(cinematic.rays === null ? [] : [cinematic.rays])];
  const placed = (): Effect[] => (passEffects(pass) ?? []).filter((effect) => install.includes(effect));
  return { scope, pass, cinematic, frame, feet, warm, recompile, placed, dispose: () => { scope.dispose(); pass.dispose(); } };
}

test('row 110: a one-cell clean world with its god rays off places no cinematic effect, and links none of their programs', () => {
  const w = world([{ cinematic: false, rays: false }]);
  try {
    const release = w.frame.contribute('home', { chain: cleanChain });
    w.frame.frame(); w.frame.frame();
    expect(w.placed()).toEqual([]);
    expect(w.warm).not.toHaveBeenCalled(); // the march's program never compiles
    expect(w.frame.state().chain.fx).toBeNull();
    expect(w.frame.state().chain.owner).toBe('home'); // its clean chain is still carried
    release();
  } finally { w.dispose(); }
});

test('row 110: a world with a cinematic cell places them at install, and crossing into it recompiles nothing', () => {
  const w = world([{ cinematic: false, rays: false }, { cinematic: true, rays: true }], 2);
  try {
    w.frame.frame();
    expect(w.placed()).toHaveLength(4); // fringe, shafts, god rays, grain
    expect(w.warm).toHaveBeenCalledTimes(1);
    const compiled = w.recompile.mock.calls.length;
    const release = w.frame.contribute('next', { chain: cinematicChain }); // its region loads
    w.feet.x = 500; w.frame.frame(); w.frame.frame(); // and the player crosses into its cell
    expect(w.frame.state().chain.fx?.carrier).toBe('next');
    expect(w.cinematic.state().rays).toBeDefined(); // the carried rays are the chain's (no depth here, so they stay at 0)
    expect(w.recompile.mock.calls.length).toBe(compiled);
    release();
  } finally { w.dispose(); }
});

test('row 110: a catalogue that cannot say places them at install, as before', () => {
  for (const carriage of [undefined, [{ cinematic: null, rays: null }], [{ cinematic: false, rays: null }]]) {
    const w = world(carriage);
    try { w.frame.frame(); expect(w.placed()).toHaveLength(4); } finally { w.dispose(); }
  }
});

test('row 110: a live chain that carries them after all gets them as its region loads, before it carries the frame', () => {
  const w = world([{ cinematic: false, rays: false }, { cinematic: false, rays: false }], 2);
  try {
    w.frame.frame();
    expect(w.placed()).toEqual([]);
    const release = w.frame.contribute('next', { chain: cinematicChain });
    expect(w.placed()).toHaveLength(4);
    expect(w.warm).toHaveBeenCalledTimes(1);
    const compiled = w.recompile.mock.calls.length;
    w.feet.x = 500; w.frame.frame();
    expect(w.frame.state().chain.fx?.carrier).toBe('next');
    expect(w.recompile.mock.calls.length).toBe(compiled);
    release();
  } finally { w.dispose(); }
});

test('row 110: the catalogue knows a cell with no look binding runs the clean chain', () => {
  expect(catalogueCarriage(undefined, 'phone')).toEqual({ cinematic: null, rays: null });
  expect(catalogueCarriage({ render: async () => null, tiers: { phone: { godRays: false } } }, 'phone')).toEqual({ cinematic: null, rays: null });
  expect(catalogueCarriage({ tiers: { phone: { godRays: false } } }, 'phone')).toEqual({ cinematic: false, rays: false });
  expect(catalogueCarriage({ tiers: { phone: { godRays: false } } }, 'desktop')).toEqual({ cinematic: false, rays: true });
  expect(catalogueCarriage({}, 'phone')).toEqual({ cinematic: false, rays: true });
  // an admitted shardfile's own data look says its chain, though its manifest binds a render
  expect(catalogueCarriage({ render: async () => null, lookChain: 'clean', tiers: { phone: { godRays: false } } }, 'phone')).toEqual({ cinematic: false, rays: false });
  expect(catalogueCarriage({ render: async () => null, lookChain: 'cinematic' }, 'phone')).toEqual({ cinematic: null, rays: null });
});
