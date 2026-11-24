// ONE-FORMAT OF38d: a native world's ranged kit from its sections. Pine's plan once named the `held.ranged` family as
// hosts (`loadout`, `combat.motion`, three `item.ranged`, `ammunition`); every fact they read is already in `combat/items`
// (each weapon's `ranged` row and profile, the loadout's equip route) and `held/loadout` (the pouch and its fallback).
// Since r10 (OF23e5, OF29e) the pinned Pine product names none of those hosts, so it is itself the proof: it stands the
// kit from the sections, arms, fires the bow and the lever rifle, saves and restores. The cut stays as the guard that a
// plan which did name them runs tick for tick with one that does not.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE } from '@wildshard/format/nativeAssembly';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { readNativeRangedItem } from '../src/server/game/plugin/nativeItems';
import { rangedKind } from '../src/server/game/shardfile/nativeAssemblyHosts';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';
import { shippedPlan, shipsPlanFile } from '../src/test/game/shippedPlan';

const HELD = new Set(['loadout', 'combat.motion', 'item.ranged', 'ammunition']);

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
type Plan = { features: { host: string }[] };
const planOf = async (product: ShardFolder): Promise<Plan> => await shippedPlan(product);
/** The product with every held host cut from its plan: the move OF38d lets Pine make. */
async function cut(product: ShardFolder): Promise<ShardFolder> {
  if (!shipsPlanFile(product)) return product; // FP16c: Pine r15 on ships no plan, so no held host to cut
  const plan = await planOf(product), bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(row => !HELD.has(row.host)) }));
  return { ...product, file: async (name: string) => name === NATIVE_ASSEMBLY_FILE ? bytes : product.file(name) };
}
const open = (fixture: Shipped, product: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: product.shardfile, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
/** The world's digest with its adapters by id: the kit now stands before the hosts it followed, so only their order moves. */
const digest = (live: NativeHeadlessResident): string => {
  const snapshot = snapshotSimHost(live.host);
  return canonicalSimDigest({ ...snapshot, adapters: [...snapshot.adapters].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) });
};
const stand = (live: NativeHeadlessResident): Extract<HeadlessCommand, { kind: 'player' }> => ({ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(live.host).yaw });
/** Arm the bow, draw and loose, arm the lever rifle and fire twice, with digests along the way. */
function fight(live: NativeHeadlessResident): string[] {
  const digests: string[] = [], step = (count: number, commands: (live: NativeHeadlessResident) => readonly HeadlessCommand[]): void => {
    for (let at = 0; at < count; at++) live.step(commands(live));
    digests.push(digest(live));
  };
  for (const flag of ['owned:lever-rifle', 'paid:king']) live.host.flags.set(flag);
  step(40, l => [stand(l), { kind: 'script', actorId: 'pine.weapon', value: 2 }]);
  step(70, l => [{ ...stand(l), heavy: {} }]);
  step(60, l => [stand(l)]);
  step(40, l => [stand(l), { kind: 'script', actorId: 'pine.weapon', value: 1 }]);
  step(2, l => [{ ...stand(l), swing: true }]);
  step(60, l => [stand(l)]);
  step(2, l => [{ ...stand(l), swing: true }]);
  step(120, l => [stand(l)]);
  return digests;
}

test('Pine with no held host stands its ranged kit from combat/items and held/loadout, tick for tick', async () => {
  const fixture = await shipped(), moved = await cut(fixture.product);
  const hosts = (await planOf(fixture.product)).features.map(row => row.host);
  expect(hosts.filter(name => HELD.has(name)), 'the pinned Pine (r10 on) names no held host').toEqual([]);
  expect((await planOf(moved)).features.map(row => row.host).filter(name => HELD.has(name))).toEqual([]);
  // each ranged row's kind comes from its profile, as the hosts named it
  const rows = fixture.product.shardfile.items.rows.filter(row => row.kind === 'weapon' && row.ranged !== undefined);
  expect(rows.map(row => [row.id, rangedKind(row)])).toEqual([['weapon.crossbow', 'bolt'], ['weapon.lever', 'cycle'], ['weapon.longbow', 'bow']]);
  const before = await open(fixture, fixture.product), after = await open(fixture, moved);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(readNativeRangedItem(after.host, 2).kind).toBe('bow');
    expect(readNativeRangedItem(after.host, 1).kind).toBe('cycle');
    expect(digest(after)).toBe(digest(before));
    const bow = readNativeRangedItem(after.host, 2), quiver = bow.kind === 'bow' ? bow.item.state.arrows : -1;
    expect(fight(after)).toEqual(fight(before));
    expect(bow.kind === 'bow' ? bow.item.state.arrows : -1, 'the bow loosed an arrow').toBeLessThan(quiver);
    restored = await open(fixture, moved, serializeSimSnapshot(snapshotSimHostBytes(after.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(after.host)));
    restored.dispose();
    // a save made under the plan that named the hosts restores into the moved world
    restored = await open(fixture, moved, serializeSimSnapshot(snapshotSimHostBytes(before.host)));
    expect(digest(restored)).toBe(digest(before));
  } finally { restored?.dispose(); after.dispose(); before.dispose(); }
}, 300_000);
