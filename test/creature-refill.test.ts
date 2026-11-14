// oxlint-disable-next-line import/no-nodejs-modules -- The room journey runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { manager } from '@wildshard/engine/test/manager';
import { overrideTerrain } from '@wildshard/engine/test/terrain';
import { CreatureRefill, REFILL_AWAY, REFILL_NEAR, REFILL_WAIT, playersNear, refillRate, roomRefillRate, syncRefillState, type RefillEntry } from '../src/server/engine/entities/creatureRefill';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SimStateAdapter } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { populationCensus } from '../src/shared/game/population/census';
import { RespawnQueue } from '../src/shared/game/population/respawn';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { canonicalSimDigest } from './fake/simState';
import { builtProduct } from './fixtures/builtProduct';
import { installBoarWorldFixture } from './fixtures/boar-world';

// J109: a spawn point refills on a timer, faster with more players near it, up to the shard's budget. J108: taming owes
// a wild one too. One player's game does not change by a byte.

await installBoarWorldFixture();
afterEach(() => { vi.restoreAllMocks(); });

const at = (x: number, z: number): { position: { x: number; z: number } } => ({ position: { x, z } });
const left = { kind: 'boar', variant: 'common', herd: 0, x: 0, z: 0, from: 'creature:1' };

function owed(players: () => readonly { position: { x: number; z: number } }[], room = (): number => 9): { refill: CreatureRefill; back: RefillEntry[] } {
  const back: RefillEntry[] = [];
  return { back, refill: new CreatureRefill({ players, room, random: () => .5, spawn: entry => { back.push(entry); } }) };
}

test('the rate is the players near the point, and one player is always exactly 1', () => {
  const room = [at(0, 0), at(REFILL_NEAR - 1, 0), at(REFILL_NEAR + 1, 0)];
  expect(playersNear(room, 0, 0)).toBe(2);
  expect([0, 1, 2, 3].map(refillRate)).toEqual([1, 1, 2, 3]);
  expect(roomRefillRate(new Map(room.map((player, i) => [i, player])), 0, 0)).toBe(2);
  expect(roomRefillRate(new Map([[0, at(0, 0)]]), 0, 0)).toBe(1);
  expect(roomRefillRate(new Map([[0, at(9999, 0)]]), 0, 0)).toBe(1);
});

test('one player owes nothing, draws nothing and keeps no state', () => {
  const random = vi.fn(() => .5), spawn = vi.fn((): void => undefined), refill = new CreatureRefill({ players: () => [at(500, 0)], room: () => 9, random, spawn });
  refill.left(left); refill.step(REFILL_WAIT * 2);
  expect(refill.pending).toEqual([]);
  expect(random).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
  const adapters = new Map<string, SimStateAdapter>();
  syncRefillState(adapters, 'refill', refill);
  expect(adapters.size).toBe(0);
});

test('two players near fill a point twice as fast as two players away from it', () => {
  const near = owed(() => [at(REFILL_AWAY + 1, 0), at(-REFILL_AWAY - 1, 0)]), far = owed(() => [at(900, 0), at(-900, 0)]);
  for (const { refill } of [near, far]) refill.left(left);
  for (let t = 0; t < REFILL_WAIT / 2; t++) { near.refill.step(1); far.refill.step(1); }
  expect(near.back.map(entry => entry.from)).toEqual(['creature:1']);
  expect(far.back).toEqual([]);
  for (let t = 0; t < REFILL_WAIT / 2; t++) far.refill.step(1);
  expect(far.back.length).toBe(1);
});

test('nothing appears in front of a player, or past the budget, and both only delay it', () => {
  let room = 0, players = [at(0, 0), at(5, 0)];
  const { refill, back } = owed(() => players, () => room);
  refill.left(left);
  refill.step(REFILL_WAIT);
  expect(back).toEqual([]);
  players = [at(500, 0), at(-500, 0)];
  refill.step(1);
  expect(back).toEqual([]);
  expect(refill.pending.length).toBe(1);
  room = 1;
  refill.step(1);
  expect(back.length).toBe(1);
  expect(refill.pending).toEqual([]);
});

test('a room that shrinks to one player holds what it owes, and its save row lives only while something is owed', () => {
  let players = [at(500, 0), at(-500, 0)];
  const { refill, back } = owed(() => players), adapters = new Map<string, SimStateAdapter>();
  refill.left(left); refill.step(1);
  syncRefillState(adapters, 'refill', refill);
  const saved = adapters.get('refill')?.snapshot() ?? null;
  expect(saved).toEqual({ clock: 0, pending: [{ ...left, wait: REFILL_WAIT - 1 }] });
  players = [at(500, 0)];
  refill.step(REFILL_WAIT * 2);
  expect(back).toEqual([]);
  const restored = owed(() => [at(500, 0), at(-500, 0)]);
  restored.refill.state.restore(saved);
  restored.refill.step(REFILL_WAIT);
  expect(restored.back.length).toBe(1);
  syncRefillState(adapters, 'refill', restored.refill);
  expect(adapters.size).toBe(0);
});

test('a return stays out of sight of whichever player is nearest it', () => {
  const queue = new RespawnQueue({ boar: { delay: { min: 1, max: 1 } } }, 40);
  queue.add('boar', undefined, 0, 0, 0, 0, 0);
  const watched = (x: number, z: number): { x: number; z: number } => ({ x: x + 10, z });
  expect(queue.take(5, 500, 0, 0, watched)).toEqual([]);
  expect(queue.take(5, 500, 0, 0).length).toBe(1);
});

test('the herd sim refills a kill and a tame in a room, and neither for one player', () => {
  const restore = overrideTerrain({ heightAt: () => 0, normalAt: () => [0, 1, 0], waterLevel: () => -100 });
  const f = manager(), animals = f.manager, herd = animals.addHerd('boar', 0, 0), body = (): ReturnType<typeof animals.spawn> => {
    const a = animals.spawn('boar', 0, 0, 0); a.herd = herd; animals.herds[herd]?.members.push(a); return a;
  };
  const kill = (a: ReturnType<typeof body>): void => { a.applyDamage(a.maxHp * 10, a.position.clone(), new Vector3(0, 0, 1)); };
  const first = body(), second = body(), third = body();
  Reflect.set(animals, 'budget', 3);

  kill(first);
  animals.update(1, 1, new Vector3(500, 0, 0));
  expect(animals.alive).toBe(2);
  for (let t = 0; t < REFILL_WAIT + 2; t++) animals.update(1, 1, new Vector3(500, 0, 0));
  expect(animals.alive).toBe(2);
  expect(animals.animals.length).toBe(3);

  const room = [{ position: new Vector3(500, 0, 0) }, { position: new Vector3(-500, 0, 0) }];
  animals.roomPlayers = () => room;
  kill(second);
  animals.tamed({ kind: third.kind, variant: third.variant, herd, x: 0, z: 0, id: third.entityId });
  animals.retire(third);
  for (let t = 0; t < REFILL_WAIT - 2; t++) animals.update(1, 1, new Vector3(500, 0, 0));
  expect(animals.alive).toBe(0);
  for (let t = 0; t < 4; t++) animals.update(1, 1, new Vector3(500, 0, 0));
  expect(animals.alive).toBe(2);
  expect(animals.herds[herd]?.members.filter(a => a.alive).length).toBe(2);
  for (let t = 0; t < REFILL_WAIT * 2; t++) animals.update(1, 1, new Vector3(500, 0, 0));
  expect(animals.alive).toBe(2); // the budget's third is the fallen first: one player's kill stays as it fell
  restore();
});

test('a shipped host runs a home twice as fast with two players near, and one player keeps the 50 s clock', async () => {
  const shard = await loadHeadlessProduct(builtProduct('sunscar-dunes')), product = shard.shardfile, descriptor = outputDescriptor(product);
  if (descriptor === undefined) throw new Error('Missing Sunscar output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${builtProduct('sunscar-dunes')}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const resident = (): ReturnType<typeof createTrustedHeadlessResident> => createTrustedHeadlessResident({ shard: product, assets, rapier, product: shard });
  const solo = await resident(), room = await resident();
  try {
    const wait = (host: typeof solo.host): number => populationCensus(host).homes.find(row => row.id === 'sunscar.home:4')?.wait ?? Number.NaN;
    const kill = (host: typeof solo.host): void => {
      const actor = host.entities.get('sunscar.home:4');
      if (actor === undefined) throw new Error('Missing home body');
      host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(), amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
    };
    const home = room.host.entities.get('sunscar.home:4')?.position;
    if (home === undefined) throw new Error('Missing home');
    const lead = leadPlayer(room.host).position;
    expect(Math.hypot(lead.x - home.x, lead.z - home.z)).toBeLessThan(REFILL_NEAR);
    room.host.addPlayer('bot', { x: home.x + 1, y: home.y + 2, z: home.z });
    kill(solo.host); kill(room.host);
    solo.step([]); room.step([]);
    for (let tick = 0; tick < 300; tick++) { solo.step([]); room.step([]); }
    expect(wait(solo.host)).toBeCloseTo(45, 4);
    expect(wait(room.host)).toBeCloseTo(40, 4);
    // the room save restores what the room owes: the home's clock is in the keeper's own row
    const restored = await createTrustedHeadlessResident({ shard: product, assets, rapier, product: shard }, serializeSimSnapshot(snapshotSimHostBytes(solo.host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(solo.host)));
    restored.dispose();
  } finally { solo.dispose(); room.dispose(); }
}, 120_000);

test('a shipped room refills a fallen herd animal through a save, and its solo twin never gains the row', async () => {
  const directory = builtProduct('pine-hollow'), shard = await loadHeadlessProduct(directory), product = shard.shardfile, descriptor = outputDescriptor(product);
  if (descriptor === undefined) throw new Error('Missing Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const open = (snapshot?: string): ReturnType<typeof createTrustedHeadlessResident> => createTrustedHeadlessResident({ shard: product, assets, rapier, product: shard }, snapshot);
  const solo = await open(), room = await open();
  const rows = (host: typeof solo.host): string[] => [...host.adapters.keys()].filter(id => id.endsWith('.refill'));
  const victim = [...room.host.entities.values()].find(actor => actor.herd >= 0);
  if (victim === undefined) throw new Error('Pine has no herd body');
  const count = room.host.entities.size;
  const { x, y, z } = leadPlayer(room.host).position;
  room.host.addPlayer('bot', { x: x + 1, y: y + 2, z });
  const fell = (host: typeof solo.host): void => {
    const actor = host.entities.get(victim.entityId);
    if (actor === undefined) throw new Error('Missing victim');
    host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: actor.combatActor(), amount: actor.maxHp * 10, point: actor.position.clone(), dir: new Vector3(0, 0, 1) });
  };
  fell(solo.host); fell(room.host);
  for (let tick = 0; tick < 3; tick++) { solo.step([]); room.step([]); }
  expect(rows(solo.host)).toEqual([]);
  expect(rows(room.host).length).toBe(1);
  const restored = await open(serializeSimSnapshot(snapshotSimHostBytes(room.host)));
  try {
    expect(rows(restored.host)).toEqual(rows(room.host));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(room.host)));
    for (let tick = 0; tick < 60 * (REFILL_WAIT + 2); tick++) room.step([]);
    expect(rows(room.host)).toEqual([]);
    expect(room.host.entities.size).toBe(count);
    expect(room.host.entities.has(victim.entityId)).toBe(false);
    expect([...room.host.entities.values()].filter(actor => actor.alive).length).toBe([...solo.host.entities.values()].filter(actor => actor.alive).length + 1);
  } finally { restored.dispose(); solo.dispose(); room.dispose(); }
}, 180_000);
