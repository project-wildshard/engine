// MMO-PLAN MP1.2: the room's tick got cheaper (each frame's row places read once for every client's view, the row sample
// loop without a closure, the trusted step's finite check without arrays, one wind schema for every seat). Speed only: the
// same wire bytes and the same bodies. This pins a digest of every byte a Nalati room sends to each of 12 clients spread
// across its distance tiers, and every body's feet, over 6 seconds, taken from the code before the change.
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the bytes the room sends.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { directLoopback } from '../src/test/engine/netLoopback';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { input, resident } from './fixtures/netBots';

const PLAYERS = 12, TICKS = 360;

test('a Nalati room sends the same bytes and moves the same bodies', async () => {
  const live = await resident('nalati-grasslands');
  try {
    const { host } = live, world = new SimNetWorld(host), spawn = leadPlayer(host).position, digest = createHash('sha256');
    const room = new NetRoom({ world, step: inputs => {
      const [lead, ...others] = inputs, commands = new Map<string, NetCommand>();
      for (const other of others) if (other.command !== null) commands.set(other.player, other.command);
      live.step(tickCommands([{ source: 'bots', commands: netTickCommands(lead?.command ?? null, lead?.acts ?? []) }], 8), commands);
    } });
    const bots: { id: string; client: NetClient; pump: () => void }[] = [];
    for (let index = 0; index < PLAYERS; index++) {
      // Rings at 3, 40, 90 and 160 m: near rows every frame, the far tiers on their own beats.
      const angle = index / PLAYERS * Math.PI * 2, reach = [3, 40, 90, 160][index % 4] ?? 3;
      const at = { x: spawn.x + Math.cos(angle) * reach, y: spawn.y, z: spawn.z + Math.sin(angle) * reach };
      const player = index === 0 ? leadPlayer(host) : host.addPlayer(`bot:${String(index)}`, { ...at, y: host.groundHeightAt(at.x, at.z) + 0.5 });
      const link = directLoopback(), client = new NetClient(link.client), send = link.server.send.bind(link.server);
      link.server.send = (channel, bytes) => { digest.update(`${String(index)}:${channel}:`).update(new Uint8Array(bytes)); send(channel, bytes); };
      room.join(link.server, world.playerOf(player.id)); client.hello(); link.pump();
      bots.push({ id: player.id, client, pump: link.pump });
    }
    room.open(); for (const bot of bots) bot.pump();
    const target = [...host.entities.keys()][0];
    for (let tick = 0; tick < TICKS; tick++) {
      bots.forEach((bot, index) => { bot.client.command(input(index, tick, target)); bot.client.flush(); bot.pump(); });
      room.tick();
      for (const bot of bots) bot.pump();
    }
    for (const [id, body] of [...host.players, ...host.entities]) digest.update(`${id}:${String(body.position.x)},${String(body.position.y)},${String(body.position.z)};`);
    expect(room.stats.tierSkips, 'far rows skip frames').toBeGreaterThan(0);
    expect(digest.digest('hex')).toBe(EXPECTED);
  } finally { live.dispose(); }
}, 120_000);

/** Taken on engine main 2887bd63, before the change. */
const EXPECTED = '6125baedd18af4ca840a688693521ab33077cf5cd57072fcd74bef8c858a88a1';
