// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-NE24c: a declared brain's mode reaches its body's state, so the wire and the page read a creature going
// for the player as one (they read `idle` before). Mossgate's grey blob (`pursue`), Brasscap's dust wyrmling (`ram-grazer`)
// and its bandit brawler (`challenge-grazer`) each read `stalk` or `attack` once the player stands near, and none ever
// reads `charge`, which the hunt's charge contact owns.
const PLAYER = 'actor.player';
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
async function product(slug: string): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array> }> {
  const directory = builtFolder(slug), loaded = await loadHeadlessFolder(directory), descriptor = outputDescriptor(loaded.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = serverInputFiles(descriptor.index.files, loaded.shardfile);
  return { shard: loaded.shardfile, assets: new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))])) };
}
// Brasscap's catalogue slug is brasscap-mesa from TC-SHIP-a; before that it is blender-template
const pins = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as { shards: { slug: string }[] }).shards;
const BRASSCAP = pins.some(row => row.slug === 'brasscap-mesa') ? 'brasscap-mesa' : 'blender-template';

for (const [slug, id, gap] of [['_template', 'grey-blob:1', 6], [BRASSCAP, 'wyrmling.2', 6], [BRASSCAP, 'brawler.1', 6]] as const) {
  test(`${slug}'s ${id} reads a chasing or attacking state with the player ${String(gap)} m off`, async () => {
    const input = await product(slug);
    const sim = createShardfileSim(input.shard, input.assets, { rapier: await rapier, quest: { fact: () => undefined, coins: () => undefined } });
    try {
      const body = sim.host.entities.get(id), player = sim.host.players.get(PLAYER);
      if (body === undefined || player === undefined) throw new Error(`Missing ${id} or the player`);
      for (let tick = 0; tick < 120; tick++) sim.host.step(); // the bodies settle on the cell's ground first
      player.position.set(body.position.x + gap, body.position.y, body.position.z); player.motor.resetAt(player.position);
      const full = player.health.attributes.health, seen = new Set<string>();
      for (let tick = 0; tick < 60 * 10 && body.alive; tick++) {
        player.health.attributes.health = full; // the player stays up: this reads the body's state, not the fight
        sim.host.step(); seen.add(body.state);
      }
      expect([...seen].some(state => state === 'stalk' || state === 'attack'), `${id} read ${[...seen].join(', ')}`).toBe(true);
      expect(seen.has('charge')).toBe(false);
    } finally { sim.dispose(); }
  }, 60_000);
}
