import { expect, test, vi } from 'vitest';
import { Mesh, Scene, Texture, type Material, type Object3D } from 'three';

// QA 2026-11-22 row 8 (opus-qa1): Sky Reach's phone layout shot the roc's cards in play, 10 s into a walk, and linked
// the shot's program and the card's in that frame (Chromium, phone tier: one 67 to 133 ms frame every run). The card
// warm ran only under phone Low's fold (DF8); every tier whose cards draw now warms them under the loader.
const shots: { material: Material | null; views: number; size: number }[] = [];
vi.mock('../src/client/engine/render/spriteViews', () => ({
  shootViews: (object: Object3D, opts: { readonly views: number; readonly size: number }) => {
    let material: Material | null = null;
    object.traverse((node) => { if (material === null && node instanceof Mesh && !Array.isArray(node.material)) material = node.material as Material; });
    shots.push({ material, ...opts });
    return { texture: new Texture(), views: opts.views, width: 1, height: 1, offsetY: 0 };
  },
}));

const { AnimalHerdView, warmCreatureCards } = await import('../src/client/engine/entities/AnimalHerdView');
const { SkyRig } = await import('../src/client/engine/world/skyRig');
const { app } = await import('../src/client/engine/app/runtime');
const { programFoldOn } = await import('../src/client/engine/render/programFold');
const { TIER_CONFIG } = await import('../src/client/engine/core/tier');
const { installKitWorldFixture } = await import('./fixtures/kit-world');

await installKitWorldFixture();

test('a tier that draws cards warms their shot and card under the loader, fold or not', () => {
  expect(programFoldOn()).toBe(false);
  expect(TIER_CONFIG.animalSpriteDist).toBeGreaterThan(TIER_CONFIG.animalHideDist);
  expect(warmCreatureCards()).toBe(true);
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing sky');
  vi.spyOn(sky, 'setupMaterial').mockImplementation(() => undefined);
  vi.spyOn(app.species, 'preloads').mockReturnValue([]);
  const scene = new Scene();
  const view = new AnimalHerdView(scene, sky, { style: 'toon', render: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0, oneMaterial: true } });
  view.stageWarmRigs([view.factory.model('bear', 'brown'), view.factory.model('bear', 'black')]);
  // one warm shot per model, one view of 4², through the kept shot material (its program is held, not freed per shot)
  expect(shots.map(({ views, size }) => [views, size])).toEqual([[1, 4], [1, 4]]);
  expect(shots[0]?.material?.name).toMatch(/^card-shot:/u);
  expect(shots[1]?.material).toBe(shots[0]?.material);
  expect(scene.getObjectByName('creature-warm:card')).toBeDefined();
  vi.restoreAllMocks();
});
