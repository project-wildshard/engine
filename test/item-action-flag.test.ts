// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { questBooks } from '../src/shared/engine/quest/players';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// TEMPLATE-E2E TC-E7: an item scene's use can raise a quest flag. Mossgate's chest prompt is an item action (it refills the
// lantern), so the kit takes it and quests never saw it: the chest paid on walk-up through a region trigger instead. With
// `setsFlag` on its item action (shard-format 0.8), the use the kit accepts raises that flag for the player who used it,
// and only for that player, and only at the prompt; a use the item turns away (a dead player's) raises nothing.
const PLAYER = 'actor.player', BOT = 'actor.bot', GHOST = 'actor.ghost', CHEST = 'template.chest.open', FLAG = 'template.chest.opened';
async function mossgate(): Promise<{ shard: Shardfile; assets: Map<string, Uint8Array> }> {
  const directory = GAMEPLAY_SLICE, product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing gameplay slice output');
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const shard = product.shardfile, actions = shard.targets.itemActions ?? [];
  expect(actions.some(row => row.scene === CHEST)).toBe(true);
  // Template rev 10 ships this row's shape itself (AP36c): the chest's item action names the chest's quest flag, and no
  // walk-up region trigger raises it any more
  expect(actions.some(row => row.scene === CHEST && row.setsFlag === FLAG)).toBe(true);
  expect(shard.quests.triggers.some(row => row.kind === 'region' && row.flag === FLAG)).toBe(false);
  return { shard, assets: new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))])) };
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
    // the second player's own press raises it in that player's book (not the lead's, which holds it already)
    const bot = sim.host.players.get(BOT); if (bot === undefined) throw new Error('Missing the second player');
    expect(kit.scene(BOT, prompt.scene)).toBe(true); sim.host.step();
    expect(has(BOT)).toBe(true);
    // a use the item turns away raises nothing: a dead player's press at the chest queues, and the item drops it
    sim.host.addPlayer(GHOST, { x: prompt.at[0], y: prompt.at[1], z: prompt.at[2] - 1 });
    const ghost = sim.host.players.get(GHOST); if (ghost === undefined) throw new Error('Missing the third player');
    sim.host.step(); ghost.health.attributes.health = 0;
    kit.command(GHOST, { seq: 1, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 });
    expect(kit.scene(GHOST, prompt.scene)).toBe(true); sim.host.step();
    expect(has(GHOST)).toBe(false);
    // revived, the dropped use stays dropped: nothing is owed to a later lantern toggle
    ghost.health.attributes.health = 100;
    kit.command(GHOST, { seq: 2, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); sim.host.step();
    expect(has(GHOST)).toBe(false);
  } finally { sim.dispose(); }
}, 60_000);
