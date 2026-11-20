import { expect, test, vi } from 'vitest';
import { Scene, type Object3D } from 'three';
import { AnimalHerdView } from '../src/client/engine/entities/AnimalHerdView';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { app } from '../src/client/engine/app/runtime';
import { installKitWorldFixture } from './fixtures/kit-world';

await installKitWorldFixture();

// DF11: a parked warm rig (DL24) is posed by nothing, so its matrices are composed once when it is staged and three's
// per-frame walk no longer recomposes (and allocates for) each of its nodes.
test('parked warm rigs hold the world matrices three would compose', () => {
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing sky');
  vi.spyOn(sky, 'setupMaterial').mockImplementation(() => undefined);
  vi.spyOn(app.species, 'preloads').mockReturnValue([]);
  const scene = new Scene();
  scene.position.set(1, 2, 3); scene.updateMatrixWorld(true);
  const view = new AnimalHerdView(scene, sky, { style: 'toon', render: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0, oneMaterial: true } });
  view.stageWarmRigs([view.factory.model('bear', 'brown')]);
  const warm = scene.getObjectByName('creature-warm');
  if (warm === undefined) throw new Error('No warm group');
  const nodes: Object3D[] = []; warm.traverse((node) => { nodes.push(node); });
  expect(nodes.length).toBeGreaterThan(10);
  expect(nodes.filter((node) => node.matrixAutoUpdate)).toEqual([]);
  scene.updateMatrixWorld();
  const held = nodes.map((node) => node.matrixWorld.toArray());
  for (const node of nodes) node.matrixAutoUpdate = true;
  scene.updateMatrixWorld(true);
  expect(nodes.map((node) => node.matrixWorld.toArray())).toEqual(held);
  vi.restoreAllMocks();
});
