// ONE-FORMAT OF23c: an elite program's main is a declared body. Pine's four elites run as v1 fight programs over the native
// roster's lair bodies; on the declared path (Pine's own from r9) each stands as a `creatures.spawns` row on an OF28 rank, in its program's
// spawn group (`pine.elite.<id>`), and the program drives that body: it adopts it at boot before any roster body, its own
// hunt layer stands aside, its rank scales its health, size and blows, it dies to the lair's rules, and the lair's respawn
// stands the same body again at the lair, whole, on its own id and rank. A save mid-fight restores it exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { creatureRank } from '@wildshard/format/creatureRanks';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost, SimValue } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

// Pine r9 declares Old Ironhide itself (OF23c) at r6's id; its variant row's 75 health, scaled by the elite rank, is r6's 300
const IRONHIDE = 'creature:164', LAIR = [-44, -76] as const, BASE_HP = 75;
const Value: v.GenericSchema<SimValue> = v.lazy(() => v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(Value), v.record(v.string(), Value)]));

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(descriptor.index.files
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
function body(host: SimHost, id: string) { const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`); return actor; }
/** the lead player stands `distance` metres east of the lair, healed */
function stand(host: SimHost, distance: number): void {
  const player = leadPlayer(host), x = LAIR[0] + distance, z = LAIR[1];
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0); player.motor.resetAt(player.position);
  player.health.attributes.health = player.health.attributes.maxHealth;
}

test("an elite program's main is a declared body: adopted, ranked, felled, stood again, saved", async () => {
  const fixture = await shipped(), shard = fixture.shard;
  expect(shard.creatures.spawns.find(row => row.id === IRONHIDE)).toMatchObject({ variant: 'ironhide', group: 'pine.elite.ironhide', rank: 'elite' });
  const live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    const host = live.host, boar = body(host, IRONHIDE), rank = creatureRank('elite');
    const roster = [...host.entities.values()].find(actor => actor.entityId !== IRONHIDE && actor.kind === 'boar' && actor.variant === 'ironhide');
    stand(host, 120); live.step([]);
    // the fight program took the declared body as its main, before the roster's lair body; its rank is the format's
    expect(boar.scripted).toBe(true);
    expect(boar.maxHp).toBeCloseTo(BASE_HP * rank.hp);
    const rosterAt = roster?.position.clone();
    // a player inside the engage radius: the program drives the declared body (its hunt layer stands aside)
    const start = boar.position.clone(); let hurt = false;
    for (let tick = 0; tick < 600; tick++) {
      stand(host, 12); const before = leadPlayer(host).health.attributes.health; live.step([]);
      if (leadPlayer(host).health.attributes.health < before) hurt = true;
    }
    expect(Math.hypot(boar.position.x - start.x, boar.position.z - start.z)).toBeGreaterThan(3);
    expect(hurt).toBe(true);
    if (roster !== undefined && rosterAt !== undefined) expect(roster.position.distanceTo(rosterAt)).toBeLessThan(0.5);
    // a save mid-fight restores the declared main and its program exactly
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    for (let tick = 0; tick < 120; tick++) { stand(host, 12); live.step([]); stand(restored.host, 12); restored.step([]); }
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    // felled: the lair's rules count it dead; its respawn stands the same declared body at the lair, whole and ranked
    host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: boar.combatActor(), amount: boar.maxHp * 2, point: boar.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    stand(host, 120); live.step([]); live.step([]);
    expect(boar.alive).toBe(false);
    const adapter = host.adapters.get('pine.elites'); if (adapter === undefined) throw new Error('Missing elite owner');
    const saved = v.parse(v.record(v.string(), v.unknown()), adapter.snapshot()), entries = v.parse(v.array(v.record(v.string(), v.unknown())), saved['entries']);
    expect(entries[0]?.['state']).toBe('dead');
    adapter.restore(v.parse(Value, { ...saved, entries: entries.map((entry, i) => i === 0 ? { ...entry, timer: 0.05 } : entry) }));
    for (let tick = 0; tick < 10; tick++) { stand(host, 120); live.step([]); }
    expect(host.entities.get(IRONHIDE)).toBe(boar);
    expect(boar.alive).toBe(true); expect(boar.hp).toBeCloseTo(BASE_HP * rank.hp); expect(boar.scripted).toBe(true);
    expect(Math.hypot(boar.position.x - LAIR[0], boar.position.z - LAIR[1])).toBeLessThan(2);
  } finally { restored?.dispose(); live.dispose(); }
}, 240_000);

// OF23c (the night): a spawn script's own group lends it declared bodies too. Pine's night thralls stand as rows in
// `pine.night`: out of the world at boot, and the night script's call stands one of them, never a roster body of theirs.
test("a spawn script's group lends it declared bodies: absent until it spawns one", async () => {
  const fixture = await shipped(), shard = fixture.shard;
  // Pine r9 declares the night's thralls itself (OF23c): its boar thralls are rows in `pine.night`
  const night = shard.creatures.spawns.filter(row => row.group === 'pine.night' && row.variant === 'thrall' && row.species.includes('boar')).map(row => row.id);
  expect(night.length).toBeGreaterThan(0);
  const live = await resident(fixture, shard);
  try {
    const host = live.host, lent = night.map(id => body(host, id));
    expect(lent.every(actor => !actor.alive)).toBe(true);
    // a save keeps them out of the world: the restored world's hunts leave them be too, and both worlds go on the same
    const twin = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(host)));
    try {
      for (let tick = 0; tick < 60; tick++) { live.step([]); twin.step([]); }
      expect(canonicalSimDigest(snapshotSimHost(twin.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    } finally { twin.dispose(); }
    const before = new Set([...host.entities.keys()]), clock = host.dayClock; if (clock === undefined) throw new Error('Missing day clock');
    await clock.set(0.95);
    const player = leadPlayer(host);
    for (let tick = 0; tick < 1200 && !lent.some(actor => actor.alive); tick++) {
      player.position.set(114, host.groundHeightAt(114, -60), -60); player.motor.resetAt(player.position); player.health.attributes.health = player.health.attributes.maxHealth;
      live.step([]);
    }
    expect(lent.some(actor => actor.alive)).toBe(true);
    // a thrall the night calls is one of its lent bodies, never a new roster body
    expect([...host.entities.values()].filter(actor => !before.has(actor.entityId) && actor.variant === 'thrall')).toEqual([]);
  } finally { live.dispose(); }
}, 240_000);
