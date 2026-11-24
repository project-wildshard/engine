// ONE-FORMAT OF23e2: a native assembly with a keyed sky and no `day.*` host takes its day from `look/keyed-sky`, as the
// `day.keyed-sky` host did. Since r9 Pine's plan names no day host (its move dropped it), so the pinned Pine product is
// the proof: its clock stands from the section and turns, and a save restores the same world tick for tick.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
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
const open = (fixture: Shipped, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: fixture.shard, assets: fixture.assets, rapier: fixture.rapier, product: fixture.product }, snapshot);
interface Frame { readonly phase: number; readonly dayPhase: string; readonly night: number }
function run(live: NativeHeadlessResident, ticks: number): Frame[] {
  const frames: Frame[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    live.step([]);
    const clock = live.host.dayClock;
    frames.push({ phase: clock?.phase ?? -1, dayPhase: clock?.dayPhase ?? 'none', night: clock?.night ?? -1 });
  }
  return frames;
}

test('Pine with no day host keeps its keyed sky clock from its section, and saves and restores', async () => {
  const fixture = await shipped();
  const plan = await shippedPlan(fixture.product);
  expect(plan.features.filter(row => row.host.startsWith('day.')), 'Pine (r9 on) names no day host').toEqual([]);
  const live = await open(fixture);
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(live.host.dayClock?.dayMinutes).toBeGreaterThan(0);
    const a = run(live, 900);
    expect(a.at(-1)?.phase).not.toBe(a[0]?.phase);
    restored = await open(fixture, serializeSimSnapshot(snapshotSimHostBytes(live.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(live.host)));
    expect(run(restored, 300)).toEqual(run(live, 300));
  } finally { restored?.dispose(); live.dispose(); }
}, 240_000);
