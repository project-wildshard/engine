// ONE-FORMAT OF22e1: Driftwood's quest hosts read the declared population. Its kill steps (`quest.kill-steps`) and its
// quest's sword guard (`quest.composition`'s acquisition) read only the mixed population's bodies (`run.island`), so once
// its sailors are declared spawns (OF22b1) a sailor's fall would file nothing and the sword would lie unguarded. Now a
// declared body counts as its species row's kind: its fall advances the kill step (`dead:sailor`), and the guard sees it
// standing. The fixture is the shipped Driftwood product with a converted Dunes strider declared as a sailor.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { parseShardfile, type Shardfile } from '@wildshard/format/shardSchema';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { declaredQuestBodies } from '../src/server/game/quest/declaredQuestBodies';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { builtFolder } from '../src/test/game/builtFolder';

const rows = JSON.parse(readFileSync('test/fixtures/dunes-of11b-rows.json', 'utf8')) as {
  rows: { species: ShardRows['species']; brains: ShardCreatures['brains']; strikes: ShardRows['strikes'] };
};
/** Driftwood's kill row `hold-key` targets `sailor` and files this flag; its quest's guard kind is `sailor` too. */
const SAILOR = 'of22e.sailor', DEAD = 'dead:sailor', AT: [number, number, number] = [8, 0, -75];

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** The shipped shard with one declared body whose species row's kind is `sailor` (a converted strider). */
function declaring(source: Shardfile): Shardfile {
  const strider = rows.rows.species.find(row => row.kind === 'duneStrider');
  if (strider === undefined) throw new Error('Missing converted strider');
  const species = [{ ...strider, id: 'of22e.creature.sailor', kind: 'sailor', body: { ...strider.body, look: 'of22e.look.sailor' },
  }] as ShardRows['species'];
  const base = emptyShardfile({ slug: 'of22e-rows', name: 'Rows', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'of22e.look.sailor', species: 'of22e.creature.sailor', recipe: 'of22e.rig', material: null, parameters: {}, animation: { recipe: 'of22e.clips', parameters: {} } }];
  const parsed = parseShardfile({ ...base, rows: { ...base.rows, species, strikes: rows.rows.strikes, looks },
    creatures: { ...base.creatures, brains: rows.rows.brains,
      spawns: [{ id: SAILOR, species: 'of22e.creature.sailor', variant: 'dusk', brain: strider.temperament?.brain ?? null, strike: null, seed: 3, scale: 1, at: AT, yaw: 0, phaseOffset: 0 }] } });
  return { ...source, rows: { ...source.rows, species: [...source.rows.species, ...parsed.rows.species], strikes: [...source.rows.strikes, ...parsed.rows.strikes],
    looks: [...source.rows.looks, ...parsed.rows.looks] }, creatures: parsed.creatures };
}
function resident(fixture: Shipped, shard: Shardfile): Promise<NativeHeadlessResident> {
  const product: ShardFolder = { ...fixture.product, shardfile: shard };
  return createNativeHeadlessResident({ shard, assets: fixture.assets, rapier: fixture.rapier, product });
}
/** The player stands beside the declared sailor, kept alive. */
function stand(host: SimHost): void {
  const player = leadPlayer(host), x = AT[0] + 3, z = AT[2];
  player.position.set(x, host.groundHeightAt(x, z), z); player.velocity.set(0, 0, 0); player.impulse.set(0, 0, 0);
  player.health.attributes.health = player.health.attributes.maxHealth;
}
function run(live: NativeHeadlessResident, ticks: number): void { for (let tick = 0; tick < ticks; tick++) { stand(live.host); live.step([]); } }

test('Driftwood\'s quest hosts read a declared sailor: his fall files the kill step, and he guards the sword while he stands', async () => {
  const fixture = await shipped(), shard = declaring(fixture.shard), live = await resident(fixture, shard);
  try {
    const { host } = live, body = host.entities.get(SAILOR), guard = declaredQuestBodies(host, shard);
    if (body === undefined) throw new Error('Missing declared sailor');
    run(live, 30);
    expect(host.flags.has(DEAD)).toBe(false);
    expect(guard.standing('sailor'), 'the declared sailor guards while he stands').toBe(true);
    expect(guard.kindOf(body.combatActor())).toBe('sailor');
    expect(guard.kindOf(leadPlayer(host)), 'no other actor is a declared body').toBeUndefined();
    for (let blow = 0; blow < 40 && body.alive; blow++) {
      host.combat.hit({ source: 'env', sourceTags: ['actor.player'], target: body.combatActor(), amount: 1e6, point: body.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
      run(live, 2);
    }
    expect(body.alive).toBe(false);
    expect(host.flags.has(DEAD), 'the declared sailor\'s fall files the kill step').toBe(true);
    expect(guard.standing('sailor')).toBe(false);
  } finally { live.dispose(); }
}, 180_000);
