// ONE-FORMAT OF23e3: a native assembly with no `weather.*` host runs the program a `world/weather` row names, as the
// `weather.program` host did. Pine's plan names that host over `world/weather.json`; its move drops it for a row. The proof
// is the pinned Pine product run beside the same product with the host cut from its plan and the row declared: the whole
// saved world matches tick for tick (the weather, its shelter and the herds that read it), and saves and restores exactly.
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
  // the files a server reads, its declared spawns' skin rigs too (a Ring 1 slice carries only these)
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
type Plan = { features: { host: string; program?: { file: string } }[] };
/** The product with its weather host cut from its native plan and, when `row`, the program it read declared as a row. */
async function cut(fixture: Shipped, row: boolean): Promise<ShardFolder> {
  const plan = JSON.parse(new TextDecoder().decode(await fixture.product.file(NATIVE_ASSEMBLY_FILE))) as Plan;
  const host = plan.features.find(feature => feature.host === 'weather.program');
  if (host?.program === undefined) throw new Error('Pine names no weather program host to cut');
  const bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(feature => feature !== host) }));
  const shardfile = row ? { ...fixture.shard, rows: { ...fixture.shard.rows, weather: [...fixture.shard.rows.weather, { id: 'pine.weather', program: host.program.file }] } } : fixture.shard;
  return { ...fixture.product, shardfile, file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : fixture.product.file(name) };
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

test('Pine with its weather program as a row and no weather host runs the same world, and saves and restores', async () => {
  const fixture = await shipped(), whole = await open(fixture, fixture.product), rowed = await cut(fixture, true), bare = await open(fixture, rowed);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(run(bare, 1200)).toEqual(run(whole, 1200));
    restored = await open(fixture, rowed, serializeSimSnapshot(snapshotSimHostBytes(bare.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(bare.host)));
    expect(run(restored, 300)).toEqual(run(bare, 300));
  } finally { restored?.dispose(); bare.dispose(); whole.dispose(); }
}, 300_000);

test('Pine with its weather host cut and no row does not stand its weather', async () => {
  const fixture = await shipped();
  await expect(open(fixture, await cut(fixture, false)).then(live => { try { run(live, 120); } finally { live.dispose(); } })).rejects.toThrow();
}, 120_000);
