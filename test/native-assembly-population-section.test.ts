// ONE-FORMAT OF29e1: a native plan that names no `population.*` host stands the population family from the product's declared
// files (environment, shelter, roster, elites, the night director, elites ready), in the hosts' order. The current Pine pin
// has no explicit population hosts. Compare it with the same product using the six declarations from the r10 pin.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE, type NativeAssemblyFeature, type NativeAssemblyPlan } from '@wildshard/format/nativeAssembly';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
const plan = async (product: ShardFolder): Promise<NativeAssemblyPlan> =>
  JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as NativeAssemblyPlan;
/** The final six features from Pine r10's native assembly plan (pin 0022c95d). */
const legacyPopulation: readonly NativeAssemblyFeature[] = [
  {host: 'population.environment', rows: {file: 'server/habitat.json'}},
  {host: 'population.shelter', rows: {file: 'actors/shelter.json'}},
  {host: 'population.roster', rows: {file: 'actors/roster.json'}},
  {host: 'population.elites', file: 'actors/elites.json'},
  {host: 'population.spawn-script', id: 'pine.night'},
  {host: 'population.elites-ready'},
];
async function withLegacyPopulation(fixture: Shipped): Promise<ShardFolder> {
  const own = await plan(fixture.product);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...own, features: [...own.features, ...legacyPopulation] }));
  const product: ShardFolder = Object.create(fixture.product) as ShardFolder;
  return Object.assign(product, { file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : fixture.product.file(name) });
}
const open = (fixture: Shipped, product: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: product.shardfile, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
function run(live: NativeHeadlessResident, ticks: number): string[] {
  const digests: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    live.step([]);
    if (tick % 60 === 59) digests.push(canonicalSimDigest(snapshotSimHost(live.host)));
  }
  return digests;
}

test('Pine with no population host in its plan runs tick for tick as with them, and saves and restores', async () => {
  const fixture = await shipped();
  expect((await plan(fixture.product)).features.some(row => row.host.startsWith('population.')), 'the shipped plan has no population hosts').toBe(false);
  const hosted = await open(fixture, await withLegacyPopulation(fixture)), declared = await open(fixture, fixture.product);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(canonicalSimDigest(snapshotSimHost(declared.host)), 'boot').toBe(canonicalSimDigest(snapshotSimHost(hosted.host)));
    expect(run(declared, 1800)).toEqual(run(hosted, 1800));
    restored = await open(fixture, fixture.product, serializeSimSnapshot(snapshotSimHostBytes(declared.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(declared.host)));
    expect(run(restored, 300)).toEqual(run(declared, 300));
  } finally { restored?.dispose(); declared.dispose(); hosted.dispose(); }
}, 600_000);
