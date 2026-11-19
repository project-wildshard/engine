// oxlint-disable-next-line import/no-nodejs-modules -- The proof runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { proveAuthoredGrid, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from '../src/test/game/builtFolder';

// SHARD-SOURCE SS-GF1a1c: a tape's E on a pickup (`world.pickup`: an item scene that takes a tool off its stand and raises a
// quest flag) runs the kit, as a data cell's page does. The author proof ran only the prompt's script scene, so the take
// never happened, its flag never rose and Glowfen's lantern run could never file its fact.
const SCENE = 'fixture.lantern-rack.take', USE = 'fixture.lantern-rack.use', AT: [number, number, number] = [20, 0, 20];
const LANTERN = 'tool.template-lantern', FLAG = 'fixture.lantern.taken';
async function withPickup(): Promise<{ readonly shard: Shardfile; readonly assets: Map<string, Uint8Array> }> {
  const directory = builtFolder('_template'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing _template output');
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile;
  const shard: Shardfile = { ...base, items: { ...base.items, loadout: { ...base.items.loadout, tools: base.items.loadout.tools.filter(id => id !== LANTERN) } },
    quests: { ...base.quests, flags: [...base.quests.flags, FLAG, 'fixture.lantern.done'],
      quests: [...base.quests.quests, { id: 'fixture.lantern', title: 'Take the lantern', completeFlag: 'fixture.lantern.done',
        steps: [{ id: 'take', objective: 'Take the lantern', done: { all: [FLAG] } }], onComplete: { fact: 'fixture.lantern.paid' } }] as never },
    targets: { ...base.targets,
      interactions: [...base.targets.interactions, { id: USE, at: AT, radius: 2, label: 'Take the lantern', scene: SCENE }],
      itemActions: [...base.targets.itemActions ?? [], { scene: SCENE, item: LANTERN, action: 3, setsFlag: FLAG }] } };
  return { shard, assets };
}

test('a tape that presses E on a pickup takes it, and the flag it raises finishes the quest', async () => {
  const { shard, assets } = await withPickup();
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const proof = await proveAuthoredGrid(shard, assets, { rapier }, { ticks: 60, checkpointTick: 40, requiredFacts: ['fixture.lantern.paid'] },
    (tick, sim) => {
      const lead = [...sim.host.players.values()][0];
      if (lead === undefined) throw new Error('Missing traveler');
      // the traveler stands at the stand (both runs, before the checkpoint), then presses E there
      if (tick === 1) { lead.position.set(AT[0], lead.position.y, AT[2] + 0.5); lead.motor.resetAt(lead.position); }
      if (tick === 10) expect(sim.interact(USE)).toBe(true);
      return undefined;
    }, (sim: ShardfileSimulation) => installDeclaredKitItems(sim.host, shard, sim.itemHooks));
  expect(proof).toBeDefined();
});
