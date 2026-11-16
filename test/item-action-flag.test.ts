// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from '../src/test/game/builtProduct';

// TEMPLATE-E2E TC-E7: an item scene's use can raise a quest flag. Mossgate's chest prompt is an item action (it refills the
// lantern), so the kit takes it and quests never saw it: the chest paid on walk-up through a region trigger instead. With
// `setsFlag` on its item action (shard-format 0.8), the use the kit accepts raises that flag for the player who used it,
// and only for that player, and only at the prompt.
const PLAYER = 'actor.player', BOT = 'actor.bot', CHEST = 'template.chest.open', FLAG = 'template.chest.opened';
async function mossgate(): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array> }> {
  const directory = builtProduct('_template'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const shard = product.shardfile, actions = shard.targets.itemActions ?? [];
  expect(actions.some(row => row.scene === CHEST)).toBe(true);
  // the shard this row lets Mossgate write: its chest's item action names the chest's quest flag, and the walk-up region
  // trigger that raised it before is gone
  expect(shard.quests.triggers.some(row => row.kind === 'region' && row.flag === FLAG)).toBe(true);
  const flagged: Shardfile = { ...shard, targets: { ...shard.targets, itemActions: actions.map(row => row.scene === CHEST ? { ...row, setsFlag: FLAG } : row) },
    quests: { ...shard.quests, triggers: shard.quests.triggers.filter(row => !(row.kind === 'region' && row.flag === FLAG)) } };
  return { shard: flagged, assets: new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))])) };
}

test("a use of Mossgate's chest prompt raises its flag for that player only, and only at the prompt", async () => {
  const input = await mossgate(), rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(input.shard, input.assets, { rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const kit = installDeclaredKitItems(sim.host, input.shard, sim.itemHooks);
    if (kit === null) throw new Error('Template declares kit items');
    const prompt = input.shard.targets.interactions.find(row => row.scene === CHEST), player = sim.host.players.get(PLAYER);
    if (prompt === undefined || player === undefined) throw new Error('Missing the chest prompt or the player');
    const put = (x: number, z: number): void => { player.position.set(x, sim.host.groundHeightAt(x, z) + 0.05, z); player.motor.resetAt(player.position); };
    sim.host.addPlayer(BOT, { x: prompt.at[0], y: prompt.at[1], z: prompt.at[2] + 1 });
    const books = questBooks(sim.host), has = (id: string): boolean => books.of(id).flags.has(FLAG);
    // far from the chest, the use names the prompt but raises nothing
    put(prompt.at[0] + prompt.radius * 4, prompt.at[2]); sim.host.step();
    kit.scene(PLAYER, prompt.scene); sim.host.step();
    expect([has(PLAYER), has(BOT)]).toEqual([false, false]);
    // at the chest, E raises it for the player who pressed it; the other player standing there has not opened it
    put(prompt.at[0], prompt.at[2]); sim.host.step();
    expect(kit.scene(PLAYER, prompt.scene)).toBe(true); sim.host.step();
    expect([has(PLAYER), has(BOT)]).toEqual([true, false]);
  } finally { sim.dispose(); }
}, 60_000);
