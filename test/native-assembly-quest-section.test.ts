// FORMAT-PRUNE FP16 (carries ONE-FORMAT OF17b3): a native plan that names no quest host stands the quest family from the
// product's `quests/server` section, after the plan's own hosts. Driftwood's and Pine's pinned plans, with their quest rows
// moved into the section, run tick for tick as the plans that name them, and save and restore; a plan naming a quest host
// beside the section, or a section holding another host, is refused.
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

const SECTION = 'quests/server';
const QUEST = new Set(['quest.chapter', 'quest.kill-steps', 'quest.body-scripts', 'quest.composition']);

async function shipped(slug: string) {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${slug} output`);
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const plan = JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as NativeAssemblyPlan;
  return { product, assets, rapier, plan };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;

/** `fixture`'s product with its plan's features replaced and, when given, a `quests/server` section of `hosts`. */
function rewritten(fixture: Shipped, features: readonly NativeAssemblyFeature[], hosts?: readonly unknown[]): ShardFolder {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...fixture.plan, features }));
  const section = { version: 1, hosts };
  const product: ShardFolder = Object.create(fixture.product) as ShardFolder;
  const has = (name: string): boolean => (hosts !== undefined && name === SECTION) || fixture.product.has(name as never);
  return Object.assign(product, {
    file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : fixture.product.file(name),
    has, section: (name: string) => hosts !== undefined && name === SECTION ? section : fixture.product.section(name as never),
  });
}
/** The plan with its quest rows moved into the section. */
function moved(fixture: Shipped): ShardFolder {
  const quest = fixture.plan.features.filter(row => QUEST.has(row.host));
  expect(quest.length, 'the pinned plan names quest hosts').toBeGreaterThan(0);
  return rewritten(fixture, fixture.plan.features.filter(row => !QUEST.has(row.host)), quest);
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

for (const slug of ['driftwood-isle', 'pine-hollow']) test(`${slug}'s quest rows in quests/server run as its plan's own, and save and restore`, async () => {
  const fixture = await shipped(slug), product = moved(fixture);
  const named = await open(fixture, fixture.product), section = await open(fixture, product);
  let restored: NativeHeadlessResident | undefined;
  const bare = await open(fixture, rewritten(fixture, fixture.plan.features.filter(row => !QUEST.has(row.host))));
  try {
    // the section is what stands the family: without it the world differs
    expect(canonicalSimDigest(snapshotSimHost(bare.host))).not.toBe(canonicalSimDigest(snapshotSimHost(named.host)));
  } finally { bare.dispose(); }
  try {
    expect(canonicalSimDigest(snapshotSimHost(section.host))).toBe(canonicalSimDigest(snapshotSimHost(named.host)));
    expect(run(section, 900)).toEqual(run(named, 900));
    restored = await open(fixture, product, serializeSimSnapshot(snapshotSimHostBytes(section.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(section.host)));
    expect(run(restored, 300)).toEqual(run(section, 300));
  } finally { restored?.dispose(); section.dispose(); named.dispose(); }
}, 600_000);

test('a quest host named in the plan beside quests/server, or another host in the section, is refused', async () => {
  const fixture = await shipped('driftwood-isle'), quest = fixture.plan.features.filter(row => QUEST.has(row.host));
  await expect(open(fixture, rewritten(fixture, fixture.plan.features, quest))).rejects.toThrow('beside the quests/server section');
  const rest = fixture.plan.features.filter(row => !QUEST.has(row.host));
  await expect(open(fixture, rewritten(fixture, rest, [...quest, { host: 'commands' }]))).rejects.toThrow();
  await expect(open(fixture, rewritten(fixture, rest, [...quest, quest[0]]))).rejects.toThrow();
}, 600_000);
