// FORMAT-PRUNE FP16d: a native plan that names no `day.*` host, with no toon or keyed sky and no `world/days` row, stands its
// day from the forest weather's sky clock (`world/forest-weather.json` `sky.clock`), as Nalati's `day.declared` host read
// it. Nalati r7's plan without that host runs digest for digest as the plan with it, and saves and restores.
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
import { foldedPlan, withPlanFile } from '../src/test/game/shippedPlan';

function run(live: NativeHeadlessResident, ticks: number): string[] {
  const digests: string[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    live.step([]);
    if (tick % 60 === 59) digests.push(canonicalSimDigest(snapshotSimHost(live.host)));
  }
  return digests;
}

test('Nalati with no day host stands its day from the forest weather clock, and saves and restores', async () => {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted nalati-grasslands output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const { product: folded, plan } = await foldedPlan(product); // FP16f: a planless pin, its sections folded into one plan
  // r7 names its day; from the SDK 0.4.30 pin on (FP16f) it names no day host, so the shipped product is the dayless world
  const declared = plan.features.some(row => row.host === 'day.declared');
  expect(plan.features.filter(row => row.host.startsWith('day.') && row.host !== 'day.declared')).toEqual([]);
  const dayless: ShardFolder = declared ? withPlanFile(folded, { ...plan, features: plan.features.filter(row => row.host !== 'day.declared') }) : product;
  const open = (folder: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
    createNativeHeadlessResident({ shard: folder.shardfile, assets, rapier, product: folder }, snapshot);
  const named = await open(product), derived = await open(dayless);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(run(derived, 900)).toEqual(run(named, 900));
    restored = await open(dayless, serializeSimSnapshot(snapshotSimHostBytes(derived.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(derived.host)));
    expect(run(restored, 300)).toEqual(run(derived, 300));
  } finally { restored?.dispose(); derived.dispose(); named.dispose(); }
}, 600_000);
