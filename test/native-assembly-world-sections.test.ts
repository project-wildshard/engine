// ONE-FORMAT OF22a1: a native assembly takes its day and its sea from its sections when its plan names no host for them.
// Driftwood's plan lists `day.toon` (its look's toon sky clock) and `water.sea` (its declared sea row) as hosts; its move
// (OF22a) drops both, so the assembly must stand the same clock from `look/toon` (or a `world/days` row) and the same
// water from the sea row. The proof is the shipped Driftwood product run beside the same product with the two hosts cut
// from its plan: the clock, the water and the whole saved world match tick for tick, and a cut product still saves and
// restores exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
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

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  // the files a server reads (a Ring 1 slice carries only these)
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The product with these hosts cut from its native plan. */
async function cut(fixture: Shipped, hosts: readonly string[]): Promise<ShardFolder> {
  const { product, plan } = await foldedPlan(fixture.product); // FP16b: a planless pin, its sections folded into one plan
  return withPlanFile(product, { ...plan, features: plan.features.filter(row => !hosts.includes(row.host)) });
}
const open = (fixture: Shipped, product: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: fixture.shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
/** Off the south shore, in the sea. */
const SEA = { x: 120, z: -235 };
interface Frame { readonly phase: number; readonly dayPhase: string; readonly night: number; readonly y: number; readonly surface: number | null }
/** The player walks off the pier into the sea and treads water; the clock and the player's float are read each tick. */
function walk(live: NativeHeadlessResident, from: number, ticks: number): Frame[] {
  const frames: Frame[] = [];
  for (let tick = from; tick < from + ticks; tick++) {
    const player = leadPlayer(live.host);
    if (tick === 0) { player.position.set(SEA.x, 1.2, SEA.z); player.velocity.set(0, 0, 0); }
    live.step([]);
    const clock = live.host.dayClock;
    frames.push({ phase: clock?.phase ?? -1, dayPhase: clock?.dayPhase ?? 'none', night: clock?.night ?? -1, y: player.position.y, surface: live.host.waterSurfaceAt(player.position.x, player.position.z) });
  }
  return frames;
}

test('Driftwood with no day or sea host keeps its toon clock and its sea from its sections, tick for tick, and saves and restores', async () => {
  const fixture = await shipped(), whole = await open(fixture, fixture.product), bare = await open(fixture, await cut(fixture, ['day.toon', 'water.sea']));
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(bare.host.dayClock?.dayMinutes).toBe(whole.host.dayClock?.dayMinutes);
    expect(bare.host.hasWater).toBe(true);
    const a = walk(whole, 0, 900), b = walk(bare, 0, 900);
    expect(b).toEqual(a);
    expect(a.at(-1)?.surface).not.toBeNull();
    expect(canonicalSimDigest(snapshotSimHost(bare.host))).toBe(canonicalSimDigest(snapshotSimHost(whole.host)));
    restored = await open(fixture, await cut(fixture, ['day.toon', 'water.sea']), serializeSimSnapshot(snapshotSimHostBytes(bare.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(bare.host)));
    expect(walk(restored, 900, 300)).toEqual(walk(bare, 900, 300));
  } finally { restored?.dispose(); bare.dispose(); whole.dispose(); }
}, 180_000);
