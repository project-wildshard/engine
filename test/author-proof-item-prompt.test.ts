// oxlint-disable-next-line import/no-nodejs-modules -- The proof runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { proveAuthoredGrid, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// TEMPLATE-E2E TC-NE5: a new repo's starter tape presses E on Mossgate's chest by its prompt id (`template.chest.use`), as
// every tape names a prompt. The chest's scene is an item action (it refills the lantern, `setsFlag` opens the chest's
// quest), so the page sends the scene and the kit takes it; the tape's id reached the kit only for a lever's or a rack's
// prompt, so the press ran the prompt's script scene, the flag never rose and the chest quest could never file its fact.
const CHEST = 'template.chest.open', USE = 'template.chest.use', FLAG = 'template.chest.opened', FACT = 'template.chest';
async function mossgate(): Promise<{ readonly shard: Shardfile; readonly assets: Map<string, Uint8Array> }> {
  const directory = builtFolder('_template'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile, actions = base.targets.itemActions ?? [];
  // the chest as sharddev's `_template` writes it since TC-E7: its item action raises the flag, no walk-up region does
  const shard: Shardfile = { ...base, targets: { ...base.targets, itemActions: actions.map(row => row.scene === CHEST ? { ...row, setsFlag: FLAG } : row) },
    quests: { ...base.quests, triggers: base.quests.triggers.filter(row => !(row.kind === 'region' && row.flag === FLAG)) } };
  return { shard, assets };
}

test("a tape's E on the chest prompt, by the prompt's id, opens the chest and files its quest's fact", async () => {
  const { shard, assets } = await mossgate();
  const prompt = shard.targets.interactions.find(row => row.id === USE);
  if (prompt === undefined || prompt.scene !== CHEST) throw new Error('Missing the chest prompt');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const proof = await proveAuthoredGrid(shard, assets, { rapier }, { ticks: 60, checkpointTick: 40, requiredFacts: [FACT] },
    (tick, sim) => {
      const lead = [...sim.host.players.values()][0];
      if (lead === undefined) throw new Error('Missing traveler');
      // the traveler stands at the chest (both runs, before the checkpoint), then presses E there
      if (tick === 1) { lead.position.set(prompt.at[0], sim.host.groundHeightAt(prompt.at[0], prompt.at[2]) + 0.05, prompt.at[2]); lead.motor.resetAt(lead.position); }
      if (tick === 10) expect(sim.interact(USE)).toBe(true);
      return undefined;
    }, (sim: ShardfileSimulation) => installDeclaredKitItems(sim.host, shard, sim.itemHooks));
  expect(proof).toBeDefined();
}, 120_000);
