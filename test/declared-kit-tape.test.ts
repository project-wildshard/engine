// oxlint-disable-next-line import/no-nodejs-modules -- The worker runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { decodeSimSnapshot, serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { bindShardfileSim, createShardfileSim, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { installDeclaredKitItems } from '../src/server/game/shardfile/declaredKitItems';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { HeadlessSimulation } from '../src/server/host/headless';
import { builtFolder } from '../src/test/game/builtFolder';
import { headlessSections } from '@wildshard/format/headlessSections';

// ONE-FORMAT OF42b: a verb tape's attack reaches a shard's declared kit weapon on the worker, as a player's wire does on the
// cell server (cellWorld feeds each command to `installDeclaredKitItems`). Before it the worker fed tape attacks to native
// catalogue weapons only, so a tape never landed a blow with a sword or whip a shard declares. J434 retired the Template and its
// whip (TEMPLATE-E2E TR-5): Brasscap's declared lever-action, the kit OF42b was built for, now takes the tape's attack.
const PLAYER = 'actor.player', BANDIT = 'bandit.camp-1.1', ROUND = 10;

test('a tape attack swings the declared kit weapon on the worker', async () => {
  const directory = builtFolder('brasscap-mesa'), product = await loadHeadlessFolder(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error('Missing brasscap-mesa output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), ports = { rapier, sections: headlessSections(descriptor.sections), quest: { fact: () => undefined, coins: () => undefined } };
  // The player stands a step and a half south of the bandit and faces it.
  const sim = createShardfileSim(shard, assets, ports), bandit = sim.host.entities.get(BANDIT), player = sim.host.players.get(PLAYER);
  if (bandit === undefined || player === undefined) throw new Error('Missing Brasscap bodies');
  player.position.set(bandit.position.x, bandit.position.y, bandit.position.z + 1.5); player.motor.resetAt(player.position); player.yaw = 0;
  sim.host.step();
  const hp = bandit.hp, snapshot = serializeSimSnapshot(snapshotSimHostBytes(sim.host)), level = sim.host.level;
  sim.dispose();
  const worker = await HeadlessSimulation.create(shard, assets, snapshot, { deadline: 'advisory' });
  let after: ShardfileSimulation | undefined;
  try {
    const attack = { kind: 'player' as const, moveX: 0, moveZ: 0, yaw: 0, attack: { targetId: BANDIT } };
    const part = await worker.verbTapePart({ version: 1, observe: [], segments: [{ id: 'lever', ticks: 90, commands: [attack] }] });
    const restored = restoreSimHost(level, { rapier }, decodeSimSnapshot(part.commit.snapshot), fresh => { after = bindShardfileSim(fresh, shard, assets, { ...ports, restoring: true }); installDeclaredKitItems(fresh, shard, after.itemHooks); });
    const struck = restored.entities.get(BANDIT);
    if (struck === undefined) throw new Error('Missing struck bandit');
    // the lever's rounds (10 each, more than one landed), never the host's zero-damage probe
    expect(struck.alive ? struck.hp : 0).toBeLessThan(hp - ROUND);
  } finally { after?.dispose(); await worker.dispose(); }
}, 60_000);
