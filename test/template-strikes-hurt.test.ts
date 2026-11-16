// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from '../src/test/game/builtProduct';

// TEMPLATE-E2E TC-M1 (J357): each of Mossgate's three brains has a strike that hurts. The pinned Template product's cell runs
// with the player standing beside one body of each: the grey blob (`pursue`), the Greyback (the patrolling elite) and a
// mossling of the pack (`creatures.groups`). Within 20 s of sim time each one's strike lowers the player's health.
const PLAYER = 'actor.player';
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
async function product(slug: string): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array> }> {
  const directory = builtProduct(slug), loaded = await loadHeadlessProduct(directory), descriptor = outputDescriptor(loaded.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, loaded.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  return { shard: loaded.shardfile, assets: new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))])) };
}
const mossgate = product('_template');

for (const id of ['grey-blob:1', 'greyback', 'mossling:1']) {
  test(`Mossgate's ${id} strikes the player beside it`, async () => {
    const input = await mossgate;
    expect(input.shard.creatures.groups.length).toBeGreaterThan(0);
    const sim = createShardfileSim(input.shard, input.assets, { rapier: await rapier, quest: { fact: () => undefined, coins: () => undefined } });
    try {
      const body = sim.host.entities.get(id), player = sim.host.players.get(PLAYER);
      if (body === undefined || player === undefined) throw new Error(`Missing ${id} or the player`);
      player.position.set(body.position.x + 2, body.position.y, body.position.z); player.motor.resetAt(player.position);
      const full = player.health.attributes.health;
      for (let tick = 0; tick < 60 * 20 && player.health.attributes.health >= full; tick++) sim.host.step();
      expect(player.health.attributes.health).toBeLessThan(full);
    } finally { sim.dispose(); }
  }, 60_000);
}

test('with every body down, the same 20 s beside the pack hurts no one: the harm is the strikes', async () => {
  const input = await mossgate;
  const sim = createShardfileSim(input.shard, input.assets, { rapier: await rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const body = sim.host.entities.get('mossling:1'), player = sim.host.players.get(PLAYER);
    if (body === undefined || player === undefined) throw new Error('Missing a mossling or the player');
    for (const other of sim.host.entities.values()) {
      if (!other.alive) continue;
      sim.host.combat.hit({ source: 'env', sourceTags: [PLAYER, 'dmg.ranged'], target: other.combatActor(), amount: 100_000, point: other.position.clone(), dir: other.position.clone().setY(0).normalize() });
    }
    player.position.set(body.position.x + 2, body.position.y, body.position.z); player.motor.resetAt(player.position);
    const full = player.health.attributes.health;
    for (let tick = 0; tick < 60 * 20; tick++) sim.host.step();
    expect(player.health.attributes.health).toBe(full);
  } finally { sim.dispose(); }
}, 60_000);
