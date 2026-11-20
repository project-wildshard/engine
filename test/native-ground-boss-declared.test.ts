// ONE-FORMAT OF23d: a ground boss's body may be declared. Pine's Antler King is a `boss.ground` roaming fight over the
// native roster's parked King; on the declared path the King stands as a `creatures.spawns` row in the fight's spawn group
// (its fight step, `pine.king`), and so do his thralls: the fight raises that body (out of the world until the night
// arms it), its summons stand the group's thralls of their kind, a retired one leaves the world, and a save mid-fight
// restores it all exactly. The King's own decision row still moves him: his declared spawn takes the row's actor id
// (`pine.antler-king`, gone from the runtime's spawns), the keeper keeps the row, and the fight lends it his body port.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { nativeGroundBossObservation } from '../src/server/game/boss/native';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { withoutRuntimeRows } from '../src/shared/game/plugin/runtimeRows';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
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
type Species = ShardRows['species'][number];
const FIGHT = 'pine.king', KING = 'pine.antler-king', CLEARING = { x: 150, z: -30 };
const THRALLS = [0, 1, 2].map(i => `pine.king.thrall.${String(i)}`);

async function shipped() {
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted pine-hollow output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
const boar = rows.rows.species.find(row => row.kind === 'boar');
if (boar === undefined) throw new Error('Missing Pine boar row');
const variant = (id: string): Species['variants'][number] => { const first = boar.variants[0]; if (first === undefined) throw new Error('Missing boar variant'); return { ...first, id }; };
/** the King's body on Pine's boar skin (the fight binds his decision row and strikes from the programme), and a boar thrall */
const king = { ...boar, id: 'of23d.king', kind: 'antler-king', variants: [variant('warden')], body: { ...boar.body, look: 'pine.look.king' } } as Species;
const thrall = { ...boar, id: 'of23d.boar.thrall', variants: [variant('thrall')], body: { ...boar.body, look: 'pine.look.thrall' } } as Species;
const spawn = (id: string, species: Species, seed: number, dx: number): Spawn => ({ id, species: species.id, variant: species.variants[0]?.id ?? '',
  brain: null, strike: null, seed, scale: 1, at: [CLEARING.x + dx, 0, CLEARING.z - 6], yaw: 0, group: FIGHT }) as Spawn;
/** OF23d (option B): his `boss` encounter row declares him (the retained actor his public decision fields need); the
 *  native fight owns his body, so it runs the encounter and the declared host stands no PhaseEncounter beside it. */
const KING_ROW: Shardfile['encounters'][number] = { id: 'pine.king.boss', entity: KING, kind: 'boss', panel: null, name: 'The Antler King',
  title: 'The Antler King', retry: 'The Antler King', arena: { at: [CLEARING.x, 0, CLEARING.z], radius: 40 }, intro: 2, introShort: 1,
  respawn: { at: [CLEARING.x, 0, CLEARING.z + 30], yaw: 0 },
  phases: [{ at: 1, name: 'The King', caption: 'The King', speed: 3, stopDistance: 3, turnRate: 3 }] };
function declaring(source: Shardfile): Shardfile {
  const base = emptyShardfile({ slug: 'of23d-king', name: 'King', author: 'Test', revision: 1, seed: 7 });
  const looks = [king, thrall].map(row => ({ id: row.body?.look ?? '', species: row.id, recipe: 'of23b.rig', material: null, parameters: {}, animation: { recipe: 'of23b.clips', parameters: {} } }));
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species: [king, thrall], strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains, spawns: [spawn(KING, king, 3, 0), ...THRALLS.map((id, i) => spawn(id, thrall, 11 + i, 2 + i))] } });
  // the King's body leaves the runtime's spawns: his declared spawn is that actor (first, so his guest's compiled handle holds)
  const own = source.runtime, spawns = own?.kind === 'client-plan' ? own.spawns : undefined;
  const runtime = own === null || spawns === undefined ? own : { ...own, spawns: Object.fromEntries(Object.entries(spawns)
    .map(([key, rows]) => [key, (rows as readonly { id: string }[]).filter(row => row.id !== KING)])) as typeof spawns };
  return { ...source, runtime, encounters: [...source.encounters, KING_ROW], rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    // Pine's own declared herds (r8 on) stay beside the King's group
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: { ...source.creatures, brains: [...source.creatures.brains, ...parsed.creatures.brains],
    spawns: [...source.creatures.spawns, ...parsed.creatures.spawns] } };
}
function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
/** his skin's chest lock point is his weak point (this boar rig names none, so the test lends one a metre over his feet) */
function chest(king: ReturnType<SimHost['entities']['get']> & object): void {
  king.bindLockPoints({ names: ['chest'], point: (_index, out) => out.set(king.position.x, king.position.y + 1, king.position.z) });
}
function body(host: SimHost, id: string) { const actor = host.entities.get(id); if (actor === undefined) throw new Error(`Missing body ${id}`); return actor; }
const seen = (host: SimHost): NonNullable<ReturnType<typeof nativeGroundBossObservation>> => {
  const row = nativeGroundBossObservation(host, FIGHT); if (row === undefined) throw new Error('No King'); return row;
};
/** the lead player stands at the clearing's edge (or `away` metres south of its centre), healed */
function stand(host: SimHost, away = 4): void {
  const player = leadPlayer(host), x = CLEARING.x, z = CLEARING.z + away;
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0); player.motor.resetAt(player.position);
  player.health.attributes.health = player.health.attributes.maxHealth;
}

test("a ground boss's declared body: raised by the night, his thralls from his group, felled, saved", async () => {
  const fixture = await shipped(), shard = declaring(fixture.shard), live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    const { host } = live, crowned = body(host, KING), pool = THRALLS.map(id => body(host, id));
    // his boss row admits his public fields with no runtime boss, and the native fight, not a PhaseEncounter, runs him
    expect(() => withoutRuntimeRows(shard)).not.toThrow();
    expect(host.adapters.has(`encounter.${KING_ROW.id}`)).toBe(false);
    chest(crowned);
    // out of the world by day: no King, no thralls, and the group is no herd
    for (let tick = 0; tick < 30; tick++) { stand(host); live.step([]); }
    expect(crowned.alive).toBe(false);
    expect(pool.every(actor => !actor.alive)).toBe(true);
    const clock = host.dayClock; if (clock === undefined) throw new Error('No day');
    clock.phase = 0.95;
    for (let tick = 0; tick < 1200 && seen(host).fight.body === null; tick++) { stand(host); live.step([]); }
    // the night raises the declared King, never a roster body
    expect(seen(host).fight.body).toBe(KING);
    expect(crowned.alive).toBe(true);
    for (let tick = 0; tick < 3600 && seen(host).boss.state !== 'fight'; tick++) { stand(host); live.step([]); }
    expect(seen(host).boss.state).toBe('fight');
    // his second phase summons, and his summons stand his group's thralls (a boar thrall is one of them; an elk still comes from the roster)
    const player = leadPlayer(host), phases = new Set<number>([seen(host).boss.phase]);
    // each blow lands on his weak point (the lent chest lock point)
    const blow = (share: number): void => { host.combat.hit({ source: player.health, sourceTags: ['actor.player'], target: crowned.combatActor(), amount: crowned.maxHp * share, point: crowned.position.clone().setY(crowned.position.y + 1), dir: new Vector3(0, 0, 1) }); };
    // his hide takes a share of a blow (the damage rule), so blows land until he is into his second phase
    for (let blows = 0; blows < 30 && seen(host).boss.phase < 1; blows++) {
      for (let wait = 0; wait < 120 && seen(host).boss.state === 'beat'; wait++) { stand(host); live.step([]); }
      blow(0.2); stand(host); live.step([]); phases.add(seen(host).boss.phase);
    }
    expect(seen(host).boss.phase).toBe(1);
    const boars = new Set<string>();
    for (let tick = 0; tick < 7200 && boars.size === 0; tick++) {
      stand(host); crowned.hp = Math.max(crowned.hp, crowned.maxHp * 0.5); live.step([]);
      for (const add of seen(host).fight.adds) if (host.entities.get(add.a)?.kind === 'boar') boars.add(add.a);
    }
    expect(boars.size).toBeGreaterThan(0);
    expect([...boars].every(id => THRALLS.includes(id))).toBe(true);
    // a save mid-fight restores the King, his thralls and the fight exactly, and both go on the same
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(host)));
    chest(body(restored.host, KING));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    for (let tick = 0; tick < 120; tick++) { stand(host); stand(restored.host); live.step([]); restored.step([]); }
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    // he falls through his three phases to the player's blows, and the crumble takes him out of the world
    for (let blows = 0; blows < 60 && seen(host).boss.state !== 'victory'; blows++) {
      for (let wait = 0; wait < 120 && seen(host).boss.state === 'beat'; wait++) { stand(host); live.step([]); }
      blow(0.3);
      for (let tick = 0; tick < 3; tick++) { stand(host); live.step([]); }
      phases.add(seen(host).boss.phase);
    }
    expect(seen(host).boss.state).toBe('victory');
    expect(phases).toEqual(new Set([0, 1, 2]));
    // he lies where he fell until the player leaves the clearing; then the fight retires him out of the world (absent again)
    for (let tick = 0; tick < 600 && seen(host).fight.body !== null; tick++) { stand(host, 150); live.step([]); }
    expect(seen(host).fight.body).toBe(null);
    expect((crowned as { hidden?: boolean }).hidden).toBe(true);
    expect(crowned.alive).toBe(false);
  } finally { restored?.dispose(); live.dispose(); }
}, 240_000);
