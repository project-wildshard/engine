// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// TEMPLATE-E2E TC-SHIP-e2: the Template's whip answers each swing through its item hook, whose answer is a declared event
// on the whip's own script entity. Nothing is scheduled on that entity, so the composed lane kept every answer queued
// forever; the 33rd swing in a room found the event queue full ("Event allowance"), the trap froze the whip's entity,
// and from then on every swing was refused. On staging a Warden fight stopped dealing damage at 40% for every player.
test('an item hook answers every swing, past the script event allowance', async () => {
  const directory = GAMEPLAY_SLICE, product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing gameplay slice output');
  const shard = product.shardfile;
  const server = serverInputFiles(descriptor.index.files, shard);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim = createShardfileSim(shard, assets, { rapier, quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const whip = sim.itemHooks('actor.player').get('weapon.template-whip');
    if (whip === undefined) throw new Error('The Template whip has an item hook');
    const answered: number[] = [];
    // well past the lane's 32-event allowance, one swing a tick as a fast player's light swings reach the server
    for (let swing = 0; swing < 80; swing++) {
      sim.host.step();
      answered.push(whip({ tick: sim.host.state.tick, dt: 1 / 60, action: 1, fuel: 0, cooldown: 0 }) ?? 0);
    }
    expect(answered.filter(action => action !== 1).length).toBe(0);
  } finally { sim.dispose(); }
});
