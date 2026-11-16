// oxlint-disable-next-line import/no-nodejs-modules -- Real cell creation uses the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { openRoad } from '../src/server/host/standalone/roadWorld';
import type { Actor } from '../src/shared/engine/combat/pipeline';
import { openCellWorld, type CellWorld } from '../src/server/host/standalone/cellWorld';
import { serverInput } from './fixtures/dedicated/roomBench';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { groups } from '../src/shared/engine/physics/groups';
import { snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
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
  const player = restored.host.players.get('actor.player'), foreign = original.host.players.get('actor.player');
  if (player === undefined || foreign === undefined) throw new Error('Missing restored seats');
  player.position.set(0, 1, 0);
  const hit = (source: Actor | 'env') => restored.host.combat.hit({ source, target: player.health, sourceTags: ['dmg.melee'],
    amount: 1, point: new Vector3(), dir: new Vector3(), throughWalls: true });
  expect(hit(foreign.health)).toBeNull();
  expect(hit('env')).not.toBeNull();
  player.position.x = 250.01;
  expect(hit('env')).toBeNull();
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


test.each(['native', 'data'])('a %s cell admits only its own interior actors to combat', async kind => {
  const cell = await open(kind === 'native' ? await serverInput('driftwood-isle') : await data()), foreign = await open(await data());
  const recipe = SIM_LEVEL.entities[0]; if (recipe === undefined) throw new Error('Missing creature');
  const local = cell.host.spawn({ ...recipe, id: 'combat.same-id', at: { x: 0, y: 1, z: 0 } });
  const other = foreign.host.spawn({ ...recipe, id: local.entityId, at: { x: 0, y: 1, z: 0 } });
  const player = cell.host.addPlayer('combat.second', { x: 1, y: 1, z: 0 });
  const hit = (source: Actor | 'env' = player.health, target: Actor = local.combatActor()) => cell.host.combat.hit({ source, target,
    sourceTags: ['dmg.melee', 'cover.checked'], amount: 1, point: new Vector3(), dir: new Vector3(), throughWalls: true });
  expect(hit()).not.toBeNull();
  expect(hit('env')).not.toBeNull();
  expect(hit(local.combatActor(), player.health)).not.toBeNull();
  const hp = local.hp, foreignHp = other.hp;
  expect(hit(other.combatActor())).toBeNull();
  expect(hit(player.health, other.combatActor())).toBeNull();
  expect(other.hp).toBe(foreignHp); expect(local.hp).toBe(hp);
  for (const [x, z] of [[250.01, 0], [-250.01, 0], [0, 250.01], [0, -250.01], [280, 280]] as const) {
    player.position.set(x, 1, z);
    expect(hit()).toBeNull();
    expect(hit(local.combatActor(), player.health)).toBeNull();
    expect(hit('env', player.health)).toBeNull();
    player.position.set(1, 1, 0); local.position.set(x, 1, z);
    expect(hit()).toBeNull(); expect(hit('env')).toBeNull();
    local.position.set(0, 1, 0);
  }
  expect(local.hp).toBe(hp);
  expect(hit()).not.toBeNull();
  expect(cell.host.removePlayer(player.id)).toBe(true);
  expect(hit()).toBeNull();
});


test('the dedicated road refuses player and environmental hits but still resolves a terminal fall', async () => {
  const road = openRoad((await data()).rapier, [], [], []);
  try {
    const first = road.players.get('actor.player'); if (first === undefined) throw new Error('Missing road player');
    const second = road.addPlayer('road.second');
    for (const source of [first.health, 'env'] as const) expect(road.combat.hit({ source, target: second.health,
      sourceTags: ['dmg.melee'], amount: 1, point: new Vector3(), dir: new Vector3(), throughWalls: true })).toBeNull();
    expect(second.health.attributes.health).toBe(100);
    expect(road.combat.fall(second.health, second.position, { kind: 'out-of-world', label: 'fall' })?.killed).toBe(true);
  } finally { road.dispose(); }
});
