// The Sunscar r3 keeper law stays under test on the pinned Dunes terrain after r4 moved the homes to spawn rows.
// dunes-r3-keeper.json is sim/runtime-plan's recipe.population from the immutable f4a1d611 Sunscar r3 product.
// oxlint-disable-next-line import/no-nodejs-modules -- Read the captured keeper declaration and the engine's WASM.
import { readFileSync } from 'node:fs';
import { parseNativeRuntimePlan } from '@wildshard/format/nativeRuntimePlan';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { loadHeadlessFolder } from '../../src/server/host/headlessFolder';
import { loadRapier } from '../../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { builtFolder, runtimeAssets } from './engine-lift/folder';

const MATRIARCH_DECISION = 'sunscar.matriarch.decision';
/** The r4 Matriarch decision module's sha256 (its `blobs/wasm/<hash>.wasm`), the key its bytes are read by. */
const KEEPER_MODULE_HASH = 'e0c2e7f9ecadd6b4d0b14015a5dfcbfa65edb42e5ddffbb4a8f015af8e422a81';

export async function dunesKeeper() {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), source = product.shardfile;
  const descriptor = outputDescriptor(source);
  if (descriptor === undefined) throw new Error('Missing verified Dunes product');
  const current = parseNativeRuntimePlan(product.section('sim/runtime-plan'));
  const population: unknown = JSON.parse(readFileSync('test/fixtures/dunes-r3-keeper.json', 'utf8'));
  const plan = parseNativeRuntimePlan({ ...current, recipe: { ...current.recipe, population } });
  const sections = new Map(descriptor.sections); sections.set('sim/runtime-plan', plan);
  // Dunes r5 moved the Matriarch to a declared encounter whose decision row binds it; the r3 keeper fights her itself, so
  // her keeper-era decision row and module come frozen from the r4 product (c60d7a64) and r5's declared encounter goes.
  const keeperDecision: unknown = JSON.parse(readFileSync('test/fixtures/frozen/dunes-r4-matriarch-decision.json', 'utf8'));
  const decisions = parseDecisionScripts(sections.get('sim/scripts')).map(row => row.id === MATRIARCH_DECISION ? parseDecisionScripts([keeperDecision])[0] ?? row : row);
  sections.set('sim/scripts', decisions);
  // The r3 keeper owns every home. Retain the terrain and scripts, but do not install the r4 declared actors beside it.
  const shard = { ...source, rows: { ...source.rows, species: [], strikes: [], looks: [] },
    creatures: { ...source.creatures, brains: [], spawns: [], groups: [] }, encounters: [] };
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const assets = runtimeAssets(product, directory);
  assets.set(KEEPER_MODULE_HASH, Uint8Array.from(readFileSync('test/fixtures/frozen/dunes-r4-matriarch-decision.wasm')));
  return { shard, assets, sections, plan, rapier, product };
}
