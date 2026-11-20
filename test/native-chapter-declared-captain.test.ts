// ONE-FORMAT OF22c1: Driftwood's chapter wakes a declared boss. The Drowned Captain was the mixed population's reserved body
// (`spawnCaptain`) under the native wake shell (`installWakeBoss`): Driftwood-only code in engine. Once his body is a declared
// spawn with a `boss` encounter on it (start `spawned`, `capExempt`), the chapter's wake row names that spawn, and the chapter
// summons the declared fight on its wake cue instead: the fight waits out of the world until then, the reserved body never
// stands, his fall files the wake row's death flag the chapter reads, and the flag clears once his body stands again. Since
// Driftwood rev 7 (OF22e2) the fixture is the shipped product: it declares him so.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { shardfileRules, type Shardfile } from '@wildshard/format/shardSchema';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHost, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';
import { builtFolder } from '../src/test/game/builtFolder';

/** The chapter's wake row names this spawn (`quests/wake-boss.json`); its encounter keeps the wake row's id. */
const CAPTAIN = 'driftwood.captain', FIGHT = 'boss.captain', DEAD = 'dead:captain', ALTAR = 'used:altar';

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const bake = await product.json<{ captain: { pool: { x: number; z: number } } }>('server/physics.json');
  return { product, shard, assets, rapier, pool: bake.captain.pool };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** Driftwood rev 7 (OF22e2) ships the Captain as this declared spawn at his pool with his `spawned` boss fight, and no
 *  runtime boss spawn: the shipped shard is the fixture. */
function declaring(fixture: Shipped): Shardfile {
  const source = fixture.shard;
  if (!source.creatures.spawns.some(row => row.id === CAPTAIN) || !source.encounters.some(row => row.id === FIGHT && row.entity === CAPTAIN)) throw new Error('Driftwood must declare the Captain and his fight');
  return source;
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
    expect([...host.entities.values()].filter(actor => actor.kind === 'captain' && actor !== body), 'no reserved body beside the declared one').toEqual([]);
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
