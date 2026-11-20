// ONE-FORMAT OF23e2: a native assembly with a keyed sky and no `day.*` host takes its day from `look/keyed-sky`, as the
// `day.keyed-sky` host does. Pine's plan names that host; its move drops it, so the assembly must stand the same clock
// from the section. The proof is the pinned Pine product run beside the same product with the host cut from its plan:
// the clock and the whole saved world match tick for tick, and a cut product still saves and restores exactly.
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
/** The product with the keyed day host cut from its native plan. */
async function cut(fixture: Shipped): Promise<ShardFolder> {
  const plan = JSON.parse(new TextDecoder().decode(await fixture.product.file(NATIVE_ASSEMBLY_FILE))) as { features: { host: string }[] };
  if (!plan.features.some(row => row.host === 'day.keyed-sky')) throw new Error('Pine names no keyed day host to cut');
  const bytes = new TextEncoder().encode(JSON.stringify({ ...plan, features: plan.features.filter(row => row.host !== 'day.keyed-sky') }));
  return { ...fixture.product, file: name => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : fixture.product.file(name) };
}
const open = (fixture: Shipped, product: ShardFolder, snapshot?: string): Promise<NativeHeadlessResident> =>
  createNativeHeadlessResident({ shard: fixture.shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
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

test('Pine with no day host keeps its keyed sky clock from its section, tick for tick, and saves and restores', async () => {
  const fixture = await shipped(), whole = await open(fixture, fixture.product), bare = await open(fixture, await cut(fixture));
  let restored: NativeHeadlessResident | undefined;
  try {
    expect(bare.host.dayClock?.dayMinutes).toBe(whole.host.dayClock?.dayMinutes);
    const a = run(whole, 900), b = run(bare, 900);
    expect(a.at(-1)?.phase).not.toBe(a[0]?.phase);
    expect(b).toEqual(a);
    expect(canonicalSimDigest(snapshotSimHost(bare.host))).toBe(canonicalSimDigest(snapshotSimHost(whole.host)));
    restored = await open(fixture, await cut(fixture), serializeSimSnapshot(snapshotSimHostBytes(bare.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(bare.host)));
    expect(run(restored, 300)).toEqual(run(bare, 300));
  } finally { restored?.dispose(); bare.dispose(); whole.dispose(); }
}, 240_000);
