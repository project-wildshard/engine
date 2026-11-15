// oxlint-disable-next-line import/no-nodejs-modules -- Real cell creation uses the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { openCellWorld, type CellWorld } from '../src/server/host/standalone/cellWorld';
import { serverInput } from './fixtures/dedicated/roomBench';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { groups } from '../src/shared/engine/physics/groups';
import { snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from './fake/simState';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { mountedPlayerOf } from '../src/server/game/riding/native';

const cells: CellWorld[] = [];
afterEach(() => { for (const cell of cells.splice(0)) if (!cell.host.scope.disposed) cell.dispose(); });
const options = () => ({ saves: new SaveStore({ local: null, session: null }), lone: false, wholeSolids: true, pageless: true });
async function data(): Promise<HeadlessRuntimeInput> {
  return { shard: emptyShardfile({ slug: 'home-cell', name: 'Home', author: 'Test', revision: 1, seed: 1 }), assets: new Map(), rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
}
async function open(input: HeadlessRuntimeInput, saved?: ReturnType<typeof snapshotSimHost>): Promise<CellWorld> {
  const cell = await openCellWorld({ instance: input.shard.identity.slug }, input, saved, options()); cells.push(cell); return cell;
}
const walls = (cell: CellWorld): number => { let count = 0; cell.host.physics.world.forEachCollider(c => { if (c.collisionGroups() === groups('BORDER')) count++; }); return count; };

test.each(['native', 'data'])('a %s cell reinstalls exactly four home walls and continues its exact snapshot', async kind => {
  const input = kind === 'native' ? await serverInput('driftwood-isle') : await data(), original = await open(input);
  expect(walls(original)).toBe(4);
  original.step([]);
  const saved = snapshotSimHost(original.host), restored = await open(input, saved);
  expect(walls(restored)).toBe(4);
  expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(original.host)));
  for (let tick = 0; tick < 3; tick++) { original.step([]); restored.step([]); }
  expect(canonicalSimDigest(snapshotSimHostBytes(restored.host))).toBe(canonicalSimDigest(snapshotSimHostBytes(original.host)));
});

test('a creature born after cell boot cannot be driven out by a later controller', async () => {
  const cell = await open(await data()), recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing creature');
  const actor = cell.host.spawn({ ...recipe, id: 'late.home', at: { x: 248, y: 1, z: 0 } });
  actor.driven = true;
  cell.host.onStep('test.outward', () => { actor.position.x += 1; });
  for (let tick = 0; tick < 60; tick++) cell.step([]);
  expect(actor.position.x).toBeLessThan(250);
  const player = cell.host.players.get('actor.player'); if (player === undefined) throw new Error('Missing player');
  player.resetPose({ x: 248, y: 1, z: 5 }, 0);
  for (let tick = 0; tick < 120; tick++) cell.host.step(new Map([[player.id, { moveX: 1, moveZ: 0, yaw: 0 }]]));
  expect(player.position.x).toBeGreaterThan(250);
});

test('a real mounted traveller crosses the home wall, while its unmounted horse stays home', async () => {
  const cell = await open(await serverInput('nalati-grasslands')), ride = mountedPlayerOf(cell.host);
  if (ride === undefined) throw new Error('Nalati riding owner missing');
  const horse = ride.mountables.find(actor => ride.canRide(actor.entityId));
  if (horse === undefined) throw new Error('Nalati has no mountable horse');
  expect(ride.mount(horse.entityId)).toBe(true);
  ride.teleport(270, 0, 0); cell.host.step();
  expect(horse.position.x).toBeGreaterThan(250);
  ride.dismount(); cell.host.step();
  expect(horse.position.x).toBeLessThan(250);
});
