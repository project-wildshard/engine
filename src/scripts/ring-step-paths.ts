// Ring 1's step paths, one per kind of row (`ring-step.ts` drives them over its rows; its test drives them on a real pin). Each walks a
// fixed line for `ticks` ticks and returns a digest every `link` ticks, chained. The caller installs the portable Math first.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { ringStepDigest } from './ring-step-digest.mjs';
import { loadRapier } from '../shared/engine/physics/rapier.ts';
import { loadHeadlessFolder } from '../server/host/headlessFolder.ts';
import { createNativeHeadlessResident } from '../server/host/headlessRuntime.ts';
import { HeadlessSimulation } from '../server/host/headless.ts';
import { outputDescriptor } from '../shared/game/shardfile/outputDescriptor.ts';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../shared/engine/sim/snapshot.ts';
import { createShardfileSim } from '../server/game/plugin/simulation.ts';
import { installDeclaredKitItems } from '../server/game/shardfile/declaredKitItems.ts';
import { planPortalRide } from '../server/game/shardfile/declaredPortalRide.ts';
import { serverInputFiles, serverSkinRigs } from '../shared/game/shardfile/serverSkinRigs.ts';
import { folderClosureFile } from '../shared/game/shardfile/shardFolder.ts';
import { folderHeadlessSections } from '../shared/host/headlessSections.ts';
import { tapeKitCommand } from '../server/host/tapeKitCommand.ts';
import { simPlayerCommand, type HeadlessCommand } from '../shared/host/tickProtocol.ts';

type Product = Awaited<ReturnType<typeof loadHeadlessFolder>>;
export interface RingStepOptions { readonly ticks: number; readonly link: number }
export interface Stepped { readonly chain: readonly string[]; readonly seconds: number; readonly path: string }

/** One fixed line of play: a walk, with a jump and a dodge in it. It installs every host and moves the player. A host that sleeps until
 *  its own verb is proved to load, not to work: that's what the tapes in row 7 are for. */
export const ringLine = (tick: number): Extract<HeadlessCommand, { kind: 'player' }> => ({ kind: 'player', moveX: 0.3 * Math.sin(tick / 90), moveZ: -1, yaw: 0, ...(tick % 47 === 0 ? { jump: true as const } : {}), ...(tick % 97 === 0 ? { dodge: true as const } : {}) });

/** A declared shard runs in the tick worker on its whole asset table, as the cook's proof does. */
async function stepDeclared(shard: Product['shardfile'], assets: ReadonlyMap<string, Uint8Array>, { ticks, link }: RingStepOptions): Promise<string[]> {
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory' }), chain: string[] = [];
  try {
    for (let tick = 1; tick <= ticks; tick++) {
      const commit = await sim.step([{ source: 'ring', commands: [ringLine(tick)] }]);
      if (commit.tick !== tick) throw new Error(`Stepped to tick ${commit.tick}, not ${tick}`);
      if (tick % link === 0) chain.push(ringStepDigest(chain.at(-1) ?? '', commit.snapshot));
    }
    return chain;
  } finally { await sim.dispose(); }
}

const PLAYER = 'actor.player';
const physics = (): ReturnType<typeof loadRapier> => loadRapier(readFileSync(createRequire(resolve('package.json')).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));

/** A declared shard's server slice runs as a room runs its data cell (cellWorld's `openDataCell`): on the server's inputs and
 *  its skin rigs, none of the art the worker's whole-table admission wants. It reaches the state the worker reaches on the head. */
async function stepDeclaredSlice(input: { shard: Product['shardfile']; assets: ReadonlyMap<string, Uint8Array>; product: Product }, { ticks, link }: RingStepOptions): Promise<string[]> {
  const { shard, product } = input, assets = new Map(input.assets);
  for (const ref of serverSkinRigs(shard)) if (!assets.has(ref)) assets.set(ref, await folderClosureFile(product, ref));
  const portalRide = product.has('client/plan') ? planPortalRide(product.section('client/plan').features) : null;
  const sim = createShardfileSim(shard, assets, { rapier: await physics(), sections: folderHeadlessSections(product), portalRide, quest: { fact: () => undefined, coins: () => undefined } });
  const kit = installDeclaredKitItems(sim.host, shard, sim.itemHooks), chain: string[] = [];
  try {
    for (let tick = 1; tick <= ticks; tick++) {
      const command = ringLine(tick);
      kit?.command(PLAYER, tapeKitCommand(sim.host, PLAYER, command, tick));
      sim.host.step(new Map([[PLAYER, simPlayerCommand(command)]]));
      if (tick % link === 0) chain.push(ringStepDigest(chain.at(-1) ?? '', serializeSimSnapshot(snapshotSimHostBytes(sim.host))));
    }
    if (sim.host.state.tick !== ticks) throw new Error(`Stepped to tick ${sim.host.state.tick}, not ${ticks}`);
    return chain;
  } finally { sim.dispose(); }
}

/** Held-melee and native-assembly shards: the resident a worker composes, in this process, walking a fixed line. */
async function stepResident(input: { shard: Product['shardfile']; assets: ReadonlyMap<string, Uint8Array>; product: Product }, { ticks, link }: RingStepOptions): Promise<string[]> {
  const resident = await createNativeHeadlessResident({ ...input, rapier: await physics() }), chain: string[] = [];
  try {
    for (let tick = 1; tick <= ticks; tick++) {
      resident.step([ringLine(tick)]);
      if (tick % link === 0) chain.push(ringStepDigest(chain.at(-1) ?? '', serializeSimSnapshot(snapshotSimHostBytes(resident.host))));
    }
    if (resident.host.state.tick !== ticks) throw new Error(`Stepped to tick ${resident.host.state.tick}, not ${ticks}`);
    return chain;
  } finally { resident.dispose(); }
}

/** Step one installed product or server slice folder on its row's path. A slice holds no art, so a read of a file a server shouldn't
 *  need fails here. */
export async function stepRingFolder(folder: string, slice: boolean, options: RingStepOptions): Promise<Stepped> {
  const started = performance.now(), product = await loadHeadlessFolder(folder), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`${folder}: no verified index`);
  const declared = shard.runtime === null && !product.has('sim/runtime-plan'), assets = new Map<string, Uint8Array>();
  // a server's reads, a declared spawn's skin rig too (a native assembly's declared herds, Pine's since OF23a), as the cook's
  // server pack carries them (`serverRows`)
  const read = new Set(serverInputFiles(descriptor.index.files, shard));
  for (const file of descriptor.index.files) {
    if ((!declared || slice) && !read.has(file)) continue;
    assets.set(file.commons === true ? `commons:${file.hash}` : file.hash, readFileSync(join(folder, file.path)));
  }
  const chain = declared ? slice ? await stepDeclaredSlice({ shard, assets, product }, options) : await stepDeclared(shard, assets, options) : await stepResident({ shard, assets, product }, options);
  return { chain, seconds: (performance.now() - started) / 1000, path: declared ? slice ? 'declared-slice' : 'declared' : shard.runtime === null ? 'held-melee' : 'native-assembly' };
}
