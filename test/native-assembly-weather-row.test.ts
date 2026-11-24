// ONE-FORMAT OF23e3: a native assembly with no `weather.*` host runs the program a `world/weather` row names, as the
// `weather.program` host did. Since r9 Pine's plan names no weather host and declares the row, so the pinned Pine product
// is the proof: it runs its weather from the row and saves and restores exactly; with the row cut it does not stand.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';
import { shippedPlan } from '../src/test/game/shippedPlan';

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
/** The product with its weather row cut. */
function cut(fixture: Shipped): ShardFolder {
  const shardfile = { ...fixture.shard, rows: { ...fixture.shard.rows, weather: [] } };
  return { ...fixture.product, shardfile };
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

test('Pine with its weather program as a row and no weather host runs its weather, and saves and restores', async () => {
  const fixture = await shipped();
  const plan = await shippedPlan(fixture.product);
  expect(plan.features.filter(feature => feature.host.startsWith('weather.')), 'Pine (r9 on) names no weather host').toEqual([]);
  expect(fixture.shard.rows.weather.length, 'Pine r9 declares its weather row').toBeGreaterThan(0);
  const live = await open(fixture, fixture.product);
  let restored: NativeHeadlessResident | undefined;
  try {
    run(live, 1200);
    restored = await open(fixture, fixture.product, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect(run(restored, 300)).toEqual(run(live, 300));
  } finally { restored?.dispose(); live.dispose(); }
}, 300_000);

test('Pine with its weather row cut does not stand its weather', async () => {
  const fixture = await shipped();
  await expect(open(fixture, cut(fixture)).then(live => { try { run(live, 120); } finally { live.dispose(); } })).rejects.toThrow();
}, 120_000);
