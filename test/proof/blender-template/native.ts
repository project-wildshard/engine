// oxlint-disable-next-line import/no-nodejs-modules -- Author compilation runs in plain Node, never in the simulated browser.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Decode immutable payloads transported by our fixed Node fixture.
import { Buffer } from 'node:buffer';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the test runner's native executable.
import { execPath } from 'node:process';
import { parseShardfile, type Shardfile } from '../../../src/shared/host/shardfile';
import { HeadlessSimulation } from '../../../src/server/host/headless';
import type { HeadlessCommandSource, HeadlessEffect, HeadlessTickCommit } from '../../../src/shared/host/tickProtocol';

export const walk: readonly HeadlessCommandSource[] = [{ source: 'player', commands: [{ kind: 'player', moveX: 0, moveZ: 1, yaw: 0 }] }];
export const door: readonly HeadlessCommandSource[] = [{ source: 'door', commands: [{ kind: 'event', type: 201, target: 1106943697, value: 1 }] }];
export function fixture(): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array>; open: (snapshot?: string) => Promise<HeadlessSimulation> }> {
  const product: unknown = JSON.parse(execFileSync(execPath, ['--import', './scripts/sim-node-loader.mjs', 'test/proof/blender-template/build.mjs'], { encoding: 'utf8', timeout: 45_000, maxBuffer: 12 * 1024 * 1024 }));
  if (typeof product !== 'object' || product === null || !('shard' in product) || !('assets' in product) || typeof product.assets !== 'object' || product.assets === null) throw new Error('Invalid native author fixture');
  const shard = parseShardfile(product.shard), assets = new Map<string, Uint8Array>();
  for (const file of shard.files) {
    const wire: unknown = Reflect.get(product.assets, file.hash);
    if (typeof wire !== 'string') throw new Error('Missing native author asset');
    assets.set(file.hash, Uint8Array.from(Buffer.from(wire, 'base64')));
  }
  // The boot/browser proofs walk from the authored spawn and exercise the door's collision.
  // These worker proofs start just outside the hall trigger: every committed tick serializes
  // the complete native world, so repeating that approach would dominate the gate under load.
  const nearby = { ...shard, spawn: { ...shard.spawn, z: 27 } };
  const open = (snapshot?: string) => HeadlessSimulation.create(nearby, assets, snapshot, { deadline: 'advisory' });
  return Promise.resolve({ shard, assets, open });
}
export async function ticks(host: HeadlessSimulation, count: number, commands: readonly HeadlessCommandSource[] = []): Promise<{ commit: HeadlessTickCommit; emissions: { tick: number; effect: HeadlessEffect }[] }> {
  if (count < 1) throw new Error('A proof tape needs a tick');
  const emissions: { tick: number; effect: HeadlessEffect }[] = [];
  let commit = await host.step(commands);
  const collect = () => { for (const effect of commit.effects) emissions.push({ tick: commit.tick, effect }); };
  collect();
  for (let at = 1; at < count; at++) { commit = await host.step(commands); collect(); }
  return { commit, emissions };
}
export async function hall(host: HeadlessSimulation): ReturnType<typeof ticks> {
  await ticks(host, 1, door);
  return ticks(host, 24, walk);
}
