// ONE-FORMAT OF22e1: Driftwood's quest hosts read the declared population. Its kill steps (`quest.kill-steps`) and its
// quest's sword guard (`quest.composition`'s acquisition) read only the mixed population's bodies (`run.island`), so once
// its sailors are declared spawns (OF22b1) a sailor's fall would file nothing and the sword would lie unguarded. Now a
// declared body counts as its species row's kind: its fall advances the kill step (`dead:sailor`), and the guard sees it
// standing. Since Driftwood rev 7 (OF22e2) the fixture is the shipped product's hold sailor.
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import type { SimHost } from '../src/server/engine/sim';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { declaredQuestBodies } from '../src/server/game/quest/declaredQuestBodies';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { builtFolder } from '../src/test/game/builtFolder';

/** Driftwood's kill row `hold-key` targets `sailor` and files this flag; its quest's guard kind is `sailor` too. */
const SAILOR = 'creature:33', DEAD = 'dead:sailor';
let AT: readonly [number, number, number] = [0, 0, 0];

async function shipped() {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing admitted driftwood-isle output');
  const assets = new Map(serverInputFiles(descriptor.index.files, shard)
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return { product, shard, assets, rapier };
}
type Shipped = Awaited<ReturnType<typeof shipped>>;
/** Driftwood rev 7 (OF22e2) declares its hold sailor: the shipped shard is the fixture. */
function declaring(source: Shardfile): Shardfile {
  if (!source.creatures.spawns.some(row => row.id === SAILOR)) throw new Error('Driftwood must declare its hold sailor');
  return source;
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
  AT = fixture.shard.creatures.spawns.find(row => row.id === SAILOR)?.at ?? AT;
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
