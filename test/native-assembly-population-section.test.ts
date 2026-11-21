// ONE-FORMAT OF29e1: a native plan that names no `population.*` host stands the population family from the product's declared
// files (environment, shelter, roster, elites, the night director, elites ready), in the hosts' order. The pinned Pine product
// is the proof: with its six population hosts cut from its plan it runs tick for tick as it does with them, and saves and
// restores exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE } from '@wildshard/format/nativeAssembly';
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
type Plan = { features: { host: string }[] };
const plan = async (product: ShardFolder): Promise<Plan> => JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as Plan;
/** The product with every `population.*` host cut from its plan. */
async function cut(fixture: Shipped): Promise<ShardFolder> {
  const own = await plan(fixture.product);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...own, features: own.features.filter(row => !row.host.startsWith('population.')) }));
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
  const fixture = await shipped(), product = await cut(fixture);
  expect((await plan(fixture.product)).features.filter(row => row.host.startsWith('population.')).map(row => row.host), 'Pine names its six hosts').toEqual([
    'population.environment', 'population.shelter', 'population.roster', 'population.elites', 'population.spawn-script', 'population.elites-ready']);
  expect((await plan(product)).features.some(row => row.host.startsWith('population.')), 'the cut plan names none').toBe(false);
  const hosted = await open(fixture, fixture.product), declared = await open(fixture, product);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(canonicalSimDigest(snapshotSimHost(declared.host)), 'boot').toBe(canonicalSimDigest(snapshotSimHost(hosted.host)));
    expect(run(declared, 1800)).toEqual(run(hosted, 1800));
    restored = await open(fixture, product, serializeSimSnapshot(snapshotSimHostBytes(declared.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(declared.host)));
    expect(run(restored, 300)).toEqual(run(declared, 300));
  } finally { restored?.dispose(); declared.dispose(); hosted.dispose(); }
}, 600_000);
