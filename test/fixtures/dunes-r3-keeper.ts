// The Sunscar r3 keeper law stays under test on the pinned Dunes terrain after r4 moved the homes to spawn rows.
// dunes-r3-keeper.json is sim/runtime-plan's recipe.population from the immutable f4a1d611 Sunscar r3 product.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the captured keeper declaration and the engine's WASM.
import { readFileSync } from 'node:fs';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { builtFolder, runtimeAssets } from './engine-lift/folder';

export async function dunesKeeper() {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), source = product.shardfile;
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) throw new Error('Missing verified Dunes product');
  const current = parseNativeRuntimePlan(product.section('sim/runtime-plan'));
  const population: unknown = JSON.parse(readFileSync('test/fixtures/dunes-r3-keeper.json', 'utf8'));
  const plan = parseNativeRuntimePlan({ ...current, recipe: { ...current.recipe, population } });
  const sections = new Map(descriptor.sections); sections.set('sim/runtime-plan', plan);
  // The r3 keeper owns every home. Retain the terrain and scripts, but do not install the r4 declared actors beside it.
  const shard = { ...source, rows: { ...source.rows, species: [], strikes: [], looks: [] },
    creatures: { ...source.creatures, brains: [], spawns: [], groups: [] } };
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { shard, assets: runtimeAssets(product, directory), sections, plan, rapier, product };
}
