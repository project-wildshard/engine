// ONE-FORMAT OF23c: an elite program's main is a declared body. Pine's four elites run as v1 fight programs over the native
// roster's lair bodies; on the declared path each stands as a `creatures.spawns` row on an OF28 rank, in its program's
// spawn group (`pine.elite.<id>`), and the program drives that body: it adopts it at boot before any roster body, its own
// hunt layer stands aside, its rank scales its health, size and blows, it dies to the lair's rules, and the lair's respawn
// stands the same body again at the lair, whole, on its own id and rank. A save mid-fight restores it exactly.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import * as v from 'valibot';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { creatureRank } from '@wildshard/format/creatureRanks';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost, SimValue } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/pine-of23b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
type Spawn = ShardCreatures['spawns'][number];
const IRONHIDE = 'of23c.ironhide', LAIR = [-44, -76] as const, BASE_HP = 300;
const Value: v.GenericSchema<SimValue> = v.lazy(() => v.union([v.null(), v.boolean(), v.number(), v.string(), v.array(Value), v.record(v.string(), Value)]));

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with Old Ironhide declared on Pine's boar row (parsed on an empty shard); its `files` stay the product's. */
function declaring(source: Shardfile, spawns: readonly Spawn[]): Shardfile {
  const base = emptyShardfile({ slug: 'of23c-elite', name: 'Elite', author: 'Test', revision: 1, seed: 7 });
  const looks = rows.rows.species.map(row => ({ id: `pine.look.${row.kind}`, species: row.id, recipe: 'of23b.rig', material: null,
    parameters: {}, animation: { recipe: 'of23b.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species: rows.rows.species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns } });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: parsed.creatures };
}
const ironhide: Spawn = { id: IRONHIDE, species: 'pine.creature.boar', variant: 'ironhide', brain: null, strike: null, seed: 5, scale: 1,
  at: [LAIR[0], 0, LAIR[1]], yaw: 0, group: 'pine.elite.ironhide', rank: 'elite' } as Spawn;
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
  const fixture = await shipped(), shard = declaring(fixture.shard, [ironhide]);
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
