// ONE-FORMAT OF22c1: Driftwood's chapter wakes a declared boss. The Drowned Captain was the mixed population's reserved body
// (`spawnCaptain`) under the native wake shell (`installWakeBoss`): Driftwood-only code in engine. Once his body is a declared
// spawn with a `boss` encounter on it (start `spawned`, `capExempt`), the chapter's wake row names that spawn, and the chapter
// summons the declared fight on its wake cue instead: the fight waits out of the world until then, the reserved body never
// stands, his fall files the wake row's death flag the chapter reads, and the flag clears once his body stands again. The
// fixture is the shipped Driftwood product with a converted Dunes strider standing in for his body at the pool.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { parseShardfile, shardfileRules, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { emptyShardfile } from '../src/shared/host/author';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
/** The chapter's wake row names this spawn (`quests/wake-boss.json`); its encounter keeps the wake row's id. */
const CAPTAIN = 'driftwood.captain', FIGHT = 'boss.captain', DEAD = 'dead:captain', ALTAR = 'used:altar';

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const bake = await product.json<{ captain: { pool: { x: number; z: number } } }>('server/physics.json');
  return { product, shard, assets, rapier, pool: bake.captain.pool };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with the Captain declared at his pool (a strider body with no brain) and his `spawned` boss fight. */
function declaring(fixture: Shipped): Shardfile {
  const source = fixture.shard, strider = rows.rows.species.find(row => row.kind === 'duneStrider');
  if (strider === undefined) throw new Error('Missing converted strider');
  const species = [{ ...strider, id: 'of22c.creature.captain', kind: 'of22cCaptain', body: { ...strider.body, look: 'of22c.look.captain' },
    temperament: { ...strider.temperament, brain: 'none' } }] as ShardRows['species'];
  const base = emptyShardfile({ slug: 'of22c-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'of22c.look.captain', species: 'of22c.creature.captain', recipe: 'of22c.rig', material: null, parameters: {}, animation: { recipe: 'of22c.clips', parameters: {} } }];
  const at: [number, number, number] = [fixture.pool.x, 0, fixture.pool.z];
  const phase = (at: number, name: string) => ({ at, name, caption: name, speed: 0, stopDistance: 2, turnRate: 6 });
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, spawns: [{ id: CAPTAIN, species: 'of22c.creature.captain', variant: 'dusk', brain: null, strike: null, seed: 3, scale: 1, at, yaw: 0 }] },
    encounters: [{ id: FIGHT, entity: CAPTAIN, kind: 'boss', panel: null, name: 'The Drowned Captain', title: 'Of the Sealed Ring', retry: 'Again',
      start: 'spawned', capExempt: true, arena: { at, radius: 22 }, intro: 0, introShort: 0, respawn: { at: [fixture.pool.x + 10, 0, fixture.pool.z], yaw: 0 },
      phases: [phase(1, 'one'), phase(0.66, 'two'), phase(0.33, 'three')] }] });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: parsed.creatures, encounters: parsed.encounters,
    // his runtime boss spawn (the page's `bindRuntimeBoss`) leaves: the declared spawn is his one body
    runtime: source.runtime === null ? null : { ...source.runtime, spawns: source.runtime.spawns === undefined ? undefined : { ...source.runtime.spawns, bosses: [] } } } as Shardfile;
}
function resident(fixture: Shipped, shard: Shardfile, snapshot?: string): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product }, snapshot);
}
const fightState = v.object({ boss: v.object({ state: v.string() }) });
function fight(host: SimHost): string {
  const slot = snapshotSimHost(host).adapters.find(row => row.id === `encounter.${FIGHT}`);
  if (typeof slot?.state !== 'string') throw new Error('Missing declared encounter step');
  return v.parse(fightState, JSON.parse(slot.state)).boss.state;
}
/** The player stands at the pool, kept alive. */
function stand(host: SimHost, pool: Shipped['pool']): void {
  const player = leadPlayer(host), x = pool.x + 3, z = pool.z;
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
function run(live: NativeHeadlessResident, pool: Shipped['pool'], ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) { stand(live.host, pool); live.step([]); }
}

test('Driftwood\'s chapter wakes the declared Captain: the fight waits for the altar, his fall files its flag, no reserved body stands', async () => {
  const fixture = await shipped(), shard = declaring(fixture);
  const live = await resident(fixture, shard);
  let restored: NativeHeadlessResident | undefined;
  try {
    const { host } = live, body = host.entities.get(CAPTAIN);
    if (body === undefined) throw new Error('Missing declared Captain');
    expect(body.capExempt, 'his blows skip the fight cap').toBe(true);
    // at the pool before the altar: the fight waits, out of the world
    run(live, fixture.pool, 120);
    expect(fight(host)).toBe('dormant'); expect(body.alive).toBe(false);
    // the altar wakes him: the chapter's wake cue summons the declared fight, which a player at the pool starts
    host.flags.set(ALTAR); run(live, fixture.pool, 120);
    expect(fight(host)).toBe('fight'); expect(body.alive).toBe(true);
    expect([...host.entities.values()].filter(actor => actor.kind === 'captain')).toEqual([]);
    expect(host.flags.has(DEAD)).toBe(false);
    // a save mid-fight restores it exactly
    restored = await resident(fixture, shard, serializeSimSnapshot(snapshotSimHostBytes(host)));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(host)));
    // his fall is the chapter's: the wake row's death flag
    for (let blow = 0; blow < 40 && body.alive; blow++) {
      host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: body.combatActor(), amount: 1e6, point: body.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
      run(live, fixture.pool, 60);
    }
    expect(body.alive).toBe(false);
    run(live, fixture.pool, 30);
    expect(fight(host)).toBe('victory');
    expect(host.flags.has(DEAD), 'his fall files the chapter\'s death flag').toBe(true);
    // his body standing again (his spawn row's return) clears it, so the chapter can wake him afresh
    body.hp = body.maxHp; body.alive = true; run(live, fixture.pool, 2);
    expect(host.flags.has(DEAD)).toBe(false);
  } finally { restored?.dispose(); live.dispose(); }
}, 180_000);

// OF22c2 (format 0.55.2): with his runtime boss spawn gone, the shipped Captain decision row's public fields (rise, phase,
// arena, ...) live on his declared spawn, which a `boss` encounter retains as the runtime boss spawn did: the shard's
// semantic rules admit them.
test('a declared Captain keeps his decision row\'s public fields with no runtime boss spawn', async () => {
  const fixture = await shipped(), shard = declaring(fixture);
  expect(shard.runtime?.spawns?.bosses).toEqual([]);
  expect(shard.state.shared.some(field => field.privacy === 'public' && field.type !== 'string')).toBe(true);
  expect(shardfileRules(shard)).not.toContain('runtime-bound state supports host fields and retained-actor numeric fields');
}, 60_000);
