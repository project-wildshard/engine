// ONE-FORMAT OF38d4a: Nalati's arsenal from its files. Its pinned plan (r6) still names the `held.arms` host: a step, the
// slots file, the sprint speed, the storm's wind rows and four script inputs. Every fact it carries is already in the
// product: `held/slots.json` declares the blade with its passes, the bow and the polearm and names the arsenal, the engine
// owns the sprint speed, and the weather owner the cooked files stand reads the same storm rows. So a plan that names no
// held host stands the arsenal itself, at the held hosts' place, with the slots' id as its step and `<id>.attack` and so
// on as its inputs. This proves the cut plan runs tick for tick with the plan that names the host under those names,
// draws, looses, swaps to the sabre and the spear, and restores either world's save.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { NATIVE_ASSEMBLY_FILE, type NativeAssemblyFeature } from '@wildshard/format/nativeAssembly';
import { parseHeldSlots } from '@wildshard/format/heldArms';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import type { HeadlessCommand } from '../src/shared/host/tickProtocol';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { NearColliders } from '../src/shared/engine/physics/nearColliders';
import { builtFolder } from '../src/test/game/builtFolder';

async function shipped() {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted nalati-grasslands output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
type Plan = { features: NativeAssemblyFeature[] };
const planOf = async (product: ShardFolder): Promise<Plan> => JSON.parse(new TextDecoder().decode(await product.file(NATIVE_ASSEMBLY_FILE))) as Plan;
const withPlan = (product: ShardFolder, plan: Plan): ShardFolder => {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return { ...product, file: async (name: string) => name === NATIVE_ASSEMBLY_FILE ? bytes : product.file(name) };
};
/** A room: the arsenal stands only where players hold it (the `held.arms` host installs in a room). */
const open = (fixture: Shipped, product: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: product.shardfile, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot, { room: true, near: new NearColliders() });
const State = v.object({ slot: v.string(), shots: v.number(), thrusts: v.number(), moves: v.array(v.string()) });

test('Nalati with no held host stands its arsenal from held/slots.json, tick for tick, and restores either save', async () => {
  const fixture = await shipped(), plan = await planOf(fixture.product);
  const id = parseHeldSlots(await fixture.product.json('held/slots.json')).id;
  const named = plan.features.find(row => row.host === 'held.arms');
  expect(named?.host, 'the r6 plan names the arsenal').toBe('held.arms');
  if (named?.host !== 'held.arms') return;
  const at = plan.features.indexOf(named);
  // the plan as the host would be named under the slots' own id: what the engine stands for a plan that names none
  const renamed: NativeAssemblyFeature = { ...named, step: id, input: { attack: `${id}.attack`, swap: `${id}.swap`, aim: `${id}.aim`, pitch: `${id}.pitch` } };
  const hosted = withPlan(fixture.product, { ...plan, features: plan.features.map(row => row === named ? renamed : row) });
  const cut = withPlan(fixture.product, { ...plan, features: plan.features.filter(row => row !== named) });
  expect(plan.features[at + 1]?.host, 'the arsenal stood before the patrol').toBe('encounter.patrol');
  const before = await open(fixture, hosted), after = await open(fixture, cut);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(canonicalSimDigest(snapshotSimHost(after.host)), 'boot').toBe(canonicalSimDigest(snapshotSimHost(before.host)));
    const state = (live: NativeHeadlessResident) => {
      const saved = live.host.adapters.get(id)?.snapshot();
      if (typeof saved !== 'string') throw new Error('Missing the arsenal');
      return v.parse(State, JSON.parse(saved));
    };
    const swap = (index: number): HeadlessCommand => ({ kind: 'script', actorId: `${id}.swap`, value: index });
    const stand = (live: NativeHeadlessResident, extra: Partial<Extract<HeadlessCommand, { kind: 'player' }>> = {}): HeadlessCommand =>
      ({ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(live.host).yaw, ...extra });
    const play = (live: NativeHeadlessResident): string[] => {
      const digests: string[] = [], run = (ticks: number, commands: (l: NativeHeadlessResident) => readonly HeadlessCommand[]): void => {
        for (let tick = 0; tick < ticks; tick++) live.step(commands(live));
        digests.push(canonicalSimDigest(snapshotSimHost(live.host)));
      };
      run(60, l => [stand(l)]); run(70, l => [stand(l, { heavy: {} })]); run(1, l => [stand(l)]); run(60, l => [stand(l)]);
      run(1, l => [stand(l), swap(1)]); run(3, l => [stand(l, { swing: true })]); run(60, l => [stand(l)]);
      run(1, l => [stand(l), swap(2)]); run(1, l => [stand(l, { swing: true })]); run(60, l => [stand(l)]);
      return digests;
    };
    expect(state(after).slot).toBe('bow');
    expect(play(after)).toEqual(play(before));
    const played = state(after);
    expect(played.shots, 'the bow loosed').toBeGreaterThan(0);
    expect(played.moves.length, 'the sabre swung').toBeGreaterThan(0);
    expect(played.slot, 'the second swap holds the spear').toBe('polearm');
    expect(played.thrusts, 'the spear thrust').toBeGreaterThan(0);
    restored = await open(fixture, cut, serializeSimSnapshot(snapshotSimHostBytes(after.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(after.host)));
    restored.dispose();
    // a save made under the plan that named the host restores into the cut world
    restored = await open(fixture, cut, serializeSimSnapshot(snapshotSimHostBytes(before.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(before.host)));
  } finally { restored?.dispose(); after.dispose(); before.dispose(); }
}, 600_000);
