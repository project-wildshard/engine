// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { GAMEPLAY_SLICE } from './fixtures/gameplaySlice';

// SHARD-SOURCE SS-GF1a2: a script's own player field (a socket a player lit, written by op 6) reaches that player's page as
// an owned line, as an item's projected field does; a host field never does, and an item's stays the kit's.
const PLAYER = 'actor.player';
test('a script player field is its owner\'s owned line; a host field is not', async () => {
  const directory = GAMEPLAY_SLICE, product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing gameplay slice output');
  const server = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const base = product.shardfile;
  const shard: Shardfile = { ...base, state: { ...base.state, player: [...base.state.player,
    { id: 9001, name: 'fixture.socket.lit', type: 'bool', privacy: 'owner', default: false },
    { id: 9002, name: 'fixture.socket.secret', type: 'i32', privacy: 'host', default: 0, min: 0, max: 9 }] } };
  const sim = createShardfileSim(shard, assets, { rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), quest: { fact: () => undefined, coins: () => undefined } });
  try {
    const lane = sim.lane; if (lane === undefined) throw new Error('Template has a script lane');
    const lines = (): Map<string, number> => { const out = new Map<string, number>(); for (const read of shardRows(sim.host).owned.values()) read(PLAYER, out); return out; };
    sim.host.step();
    expect(lines().get('fixture.socket.lit') ?? 0).toBe(0);
    // the script's op 6 for this player, as a saved world carries it
    const saved = lane.world.checkpoint(), order = shard.state.player.map(field => field.name);
    lane.world.restoreState({ ...saved, players: saved.players.map(row => row.actorId !== PLAYER ? row : { ...row, values: order.map((name, i) => name === 'fixture.socket.lit' ? 1 : name === 'fixture.socket.secret' ? 7 : row.values[i] ?? 0) }) });
    expect(lane.world.viewField(PLAYER, 'player', 'fixture.socket.lit')).toBe(1);
    sim.host.step();
    const after = lines();
    expect(after.get('fixture.socket.lit')).toBe(1);
    expect(after.has('fixture.socket.secret')).toBe(false);
  } finally { sim.dispose(); }
});
