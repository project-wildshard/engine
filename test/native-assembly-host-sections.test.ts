// FORMAT-PRUNE FP16 (carries ONE-FORMAT OF17b3): every native host stands from primitives. Each pinned plan (Driftwood r10,
// Pine r13, Nalati r7) rewritten to name no host at all, its rows moved into their family sections (`server/quest`,
// `server/riding`, `server/boss`, `server/patrol`), runs digest for digest as the plan that names them, and saves and
// restores. The plumbing comes with the quest family, `collision` with a bake read whole, the day from the look or the
// forest clock (FP16d1).
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE, type NativeAssemblyFeature } from '@wildshard/format/nativeAssembly';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';
import { shippedPlan, shipsPlanFile, withPlanFile } from '../src/test/game/shippedPlan';

/** Where each moved host's row goes; a host not here (plumbing, collision, the day) stands with no row. */
const FAMILY: readonly (readonly [string, (host: string) => boolean])[] = [
  ['server/quest', host => host.startsWith('quest.')],
  ['server/riding', host => host.startsWith('riding.')],
  ['server/boss', host => host.startsWith('boss.')],
  ['server/patrol', host => host === 'encounter.patrol'],
];
const DERIVED = new Set(['decisions', 'commands', 'collision', 'day.declared']);

async function shipped(slug: string) {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${slug} output`);
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, assets, rapier, plan: await shippedPlan(product) };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;

/** `fixture`'s product with its plan naming `features` and the given family sections. */
function rewritten(fixture: Shipped, features: readonly NativeAssemblyFeature[], sections: ReadonlyMap<string, readonly unknown[]>): ShardFolder {
  const planned = withPlanFile(fixture.product, { ...fixture.plan, features: [...features] });
  return Object.assign(Object.create(planned) as ShardFolder, {
    has: (name: string): boolean => sections.has(name) || planned.has(name as never),
    section: (name: string): unknown => { const hosts = sections.get(name); return hosts === undefined ? planned.section(name as never) : { version: 1, hosts }; },
  });
}
/** Every host row the product writes: its plan's, or (FP16b, FP16c, FP16f) its family sections' when it ships no plan. */
function hostRows(fixture: Shipped): readonly NativeAssemblyFeature[] {
  if (shipsPlanFile(fixture.product)) return fixture.plan.features;
  const product = fixture.product as unknown as { has(name: string): boolean; section(name: string): { hosts: NativeAssemblyFeature[] } };
  return FAMILY.flatMap(([name]) => product.has(name) ? product.section(name).hosts : []);
}
/** A product that ships no plan file is already the hostless world: it runs, saves and restores tick for tick. */
async function runsAsShipped(fixture: Shipped): Promise<void> {
  expect(fixture.plan.features, 'a product with no plan file names no host').toEqual([]);
  expect(hostRows(fixture).length, 'its hosts stand from family sections').toBeGreaterThan(0);
  const live = await open(fixture, fixture.product);
  let restored: NativeHeadlessResident | undefined;
  try {
    run(live, 900);
    restored = await open(fixture, fixture.product, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect(run(restored, 300)).toEqual(run(live, 300));
  } finally { restored?.dispose(); live.dispose(); }
}
/** The plan with every host moved: rows into their family sections, the rest left to stand with no row. */
function hostless(fixture: Shipped): ShardFolder {
  const sections = new Map<string, unknown[]>();
  for (const row of fixture.plan.features) {
    const family = FAMILY.find(([, owns]) => owns(row.host));
    if (family !== undefined) sections.set(family[0], [...sections.get(family[0]) ?? [], row]);
    else expect(DERIVED.has(row.host), `${row.host} stands with no row`).toBe(true);
  }
  return rewritten(fixture, [], sections);
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

for (const slug of ['driftwood-isle', 'pine-hollow', 'nalati-grasslands']) test(`${slug}'s plan naming no host runs as the plan that names them, and saves and restores`, async () => {
  const fixture = await shipped(slug);
  if (!shipsPlanFile(fixture.product)) { await runsAsShipped(fixture); return; }
  const product = hostless(fixture);
  const named = await open(fixture, fixture.product), derived = await open(fixture, product);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(canonicalSimDigest(snapshotSimHost(derived.host))).toBe(canonicalSimDigest(snapshotSimHost(named.host)));
    expect(run(derived, 900)).toEqual(run(named, 900));
    restored = await open(fixture, product, serializeSimSnapshot(snapshotSimHostBytes(derived.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(derived.host)));
    expect(run(restored, 300)).toEqual(run(derived, 300));
  } finally { restored?.dispose(); derived.dispose(); named.dispose(); }
}, 600_000);

test('a family host named in the plan beside its section, or a section holding another family, is refused', async () => {
  const fixture = await shipped('nalati-grasslands'), rows = hostRows(fixture), riding = rows.filter(row => row.host.startsWith('riding.'));
  const named = shipsPlanFile(fixture.product) ? fixture.plan.features : riding;
  await expect(open(fixture, rewritten(fixture, named, new Map([['server/riding', riding]])))).rejects.toThrow('beside the server/riding section');
  await expect(open(fixture, rewritten(fixture, [], new Map([['server/riding', [...riding, ...rows.filter(row => row.host === 'boss.arena')]]])))).rejects.toThrow('holds its own family');
});

/** FORMAT-PRUNE FP21: `fixture`'s product with no plan file: its settings in `server/world`, its hosts in their sections. */
function planless(fixture: Shipped): ShardFolder {
  const hostless_ = hostless(fixture), { kind: _kind, features: _features, ...world } = fixture.plan;
  const product: ShardFolder = Object.create(hostless_) as ShardFolder;
  return Object.assign(product, {
    hasFile: (name: string): boolean => name !== NATIVE_ASSEMBLY_FILE && fixture.product.hasFile(name),
    has: (name: string): boolean => name === 'server/world' || hostless_.has(name as never),
    section: (name: string): unknown => name === 'server/world' ? { version: 1, ...world } : hostless_.section(name as never),
  });
}

for (const slug of ['driftwood-isle', 'pine-hollow', 'nalati-grasslands']) test(`${slug} with no plan file, its settings in server/world, runs as the plan`, async () => {
  const fixture = await shipped(slug);
  if (!shipsPlanFile(fixture.product)) {
    // FP16b, FP16c, FP16f: the pinned product is this world as shipped (runsAsShipped runs it)
    expect((fixture.product as unknown as { has(name: string): boolean }).has('server/world')).toBe(true);
    return;
  }
  const product = planless(fixture);
  const named = await open(fixture, fixture.product), world = await open(fixture, product);
  try {
    expect(canonicalSimDigest(snapshotSimHost(world.host))).toBe(canonicalSimDigest(snapshotSimHost(named.host)));
    expect(run(world, 600)).toEqual(run(named, 600));
  } finally { world.dispose(); named.dispose(); }
}, 600_000);

test('a plan file beside server/world is refused', async () => {
  const fixture = await shipped('pine-hollow'), world = shipsPlanFile(fixture.product) ? planless(fixture) : fixture.product;
  const bytes = new TextEncoder().encode(JSON.stringify(fixture.plan));
  const both: ShardFolder = Object.assign(Object.create(world) as ShardFolder, {
    hasFile: (name: string): boolean => name === NATIVE_ASSEMBLY_FILE || world.hasFile(name),
    file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : world.file(name),
  });
  await expect(open(fixture, both)).rejects.toThrow('not both');
});
