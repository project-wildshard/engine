// MMO-PLAN MP1.2: the room's tick got cheaper (each frame's row places read once for every client's view, the row sample
// loop without a closure, the trusted step's finite check without arrays, one wind schema for every seat; then the seats'
// wind read once a step, the taming law's keys made once, the owned rows' names made once). Speed only: the same wire bytes
// and the same bodies. This pins a digest of every byte a Nalati room sends to each of 12 clients spread across its distance
// tiers, and every body's feet after every tick, over 6 seconds, taken from the code before each change. The second case
// opens the world as a cell's room does (`room: true` with its near colliders), so the seats' held arms run as on the box,
// and also hashes every owner's saved state each half second: a seat's wind or arrows would show there.
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the bytes the room sends.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { directLoopback } from '../src/test/engine/netLoopback';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { NearColliders } from '../src/shared/engine/physics/nearColliders';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { input, resident } from './fixtures/netBots';

const PLAYERS = 12, TICKS = 360, STATE_EVERY = 30;
/** The bots' thumbs, and in the armed room a held heavy press for 1.5 s of every 5: the bow draws and looses into the wind. */
const thumb = (armed: boolean, index: number, tick: number, target: string | undefined): Omit<NetCommand, 'seq'> => {
  const command = input(index, tick, target), phase = (tick + index * 17) % 300;
  return armed && phase >= 60 && phase < 150 ? { ...command, buttons: (command.buttons & ~NET_BUTTONS.sprint) | NET_BUTTONS.heavy } : command;
};

async function roomDigest(room: boolean): Promise<string> {
  const live = await resident('nalati-grasslands', room ? { room: true, near: new NearColliders() } : undefined);
  try {
    const { host } = live, world = new SimNetWorld(host), spawn = leadPlayer(host).position, digest = createHash('sha256');
    const net = new NetRoom({ world, step: inputs => {
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
      net.join(link.server, world.playerOf(player.id)); client.hello(); link.pump();
      bots.push({ id: player.id, client, pump: link.pump });
    }
    net.open(); for (const bot of bots) bot.pump();
    const target = [...host.entities.keys()][0];
    for (let tick = 0; tick < TICKS; tick++) {
      bots.forEach((bot, index) => { bot.client.command(thumb(room, index, tick, target)); bot.client.flush(); bot.pump(); });
      net.tick();
      for (const bot of bots) bot.pump();
      for (const [id, body] of [...host.players, ...host.entities]) digest.update(`${id}:${String(body.position.x)},${String(body.position.y)},${String(body.position.z)};`);
      if (room && tick % STATE_EVERY === STATE_EVERY - 1) for (const [id, adapter] of [...host.adapters].sort(([a], [b]) => a.localeCompare(b))) digest.update(`${id}=${JSON.stringify(adapter.snapshot())};`);
    }
    expect(net.stats.tierSkips, 'far rows skip frames').toBeGreaterThan(0);
    // The armed seats' arrows fly through the seats' copy of the weather's wind, so the state digest reads it.
    if (room) expect([...host.adapters.values()].reduce((sum, adapter) => sum + [...JSON.stringify(adapter.snapshot()).matchAll(/\\?"shots\\?":(\d+)/gu)].reduce((n, [, shots]) => n + Number(shots), 0), 0), 'the seats loose arrows').toBeGreaterThan(0);
    return digest.digest('hex');
  } finally { live.dispose(); }
}

test('a Nalati room sends the same bytes and moves the same bodies', async () => {
  expect(await roomDigest(false)).toBe(EXPECTED);
}, 120_000);

test('a Nalati cell room, its seats armed, sends the same bytes and keeps the same state', async () => {
  expect(await roomDigest(true)).toBe(EXPECTED_ROOM);
}, 120_000);

/** Taken on engine main 2887bd63, before the first change; re-taken for TE-ENG7, whose `animal.species` adds one
 *  initial text to every creature spawn (an empty one for Nalati's native bodies). Re-taken for ENG-18: three far bots
 *  of this bare resident fell through to y -300 for ever; its fall net now puts them back at the spawn. Re-taken for
 *  REMOTE-PLAYERS RP6, whose player row for others carries a swing count, its weight and the airborne bit. Re-taken for GRID-CROSSING
 *  GC36 (J322, no walls): Nalati's bake holds untagged chunk-edge walls, which no world stands now. Re-taken for
 *  NET-LAG NL13 (J280): partial stalls retry, and grounded flat support starts from its measured skin plane. Re-taken for
 *  NL13b4 (J280): a grounded sideways move on flat static support starts 0.5 mm clear of the floor (old law: 53c0f3a2). Re-taken
 *  for ONE-FORMAT CC28a (wire 1.1): every animal row carries four actor channels and its lock answer (old: ec2c462e). Re-taken
 *  for NL14b2 (J280): grounded feet on a terrain bank against a wall start two skins off the bank (old law: 3c1af4b6). Re-taken
 *  for MMO-PLAN MP1.5b (wire 1.2): every player row for others carries roadX and roadZ, zero in a cell (old: ba1c1187). Re-taken
 *  for MP5.2b (wire 1.3): every creature row carries roadX and roadZ, zero in a cell (old: b7a04dc8).
 *  Restored cell positions and distance tiers by recognizing the decoded wire zero (old: fa844910). Re-taken for ONE-FORMAT
 *  CC11a2c (wire 1.4): every creature row carries its running ability and how far through, zero when none (old: cdbcfce3).
 *  Re-taken for NL14b1 (J280): `slideOffBank` measures the bank as the terrain's slope across the nearest point and drops
 *  the push into it on a ramp across the climb limit (old law: 388e1517). Re-taken for ONE-FORMAT CC18c (wire 1.5): the
 *  welcome's event table gains event 16 `flight` (old: 8e8f6a3a). Re-taken for bb47b6afb: a jump pressed on a grounded step
 *  that names no ground collider (the motor's snap up a small lip) now asks the floor under the feet, so a bot's jump at a
 *  lip is no longer eaten (old law: 1d8b8366). */
const EXPECTED = 'd2074fab0ba6e12400d4437018b00ab8ed988ae1f239aba7aeb374c2b3eae792';
/** Taken on engine main f03e8341, before the second change; re-taken for TE-ENG7 as above. Re-taken for SS4 (75a5d6ae):
 *  each seat now has a stealth seat whose state the digest hashes, and an arrow loosed from Hidden hits for x2. Re-taken
 *  for RP6 as above. Re-taken for GC36 and NL13 as above. Re-taken for Nalati continuation af0adf3f:
 *  the King now owns its native contact pose, and adapter state retains it and the view guest clocks/globals.
 *  The unarmed wire/body oracle above remains unchanged. Previous armed digest: b891e9d2451520250c7540b96103e86fea17bf710418e784519058e4ea2c829a.
 *  Re-taken for NL13b4 as above (old law: cd2d9048). Re-taken for CC28a as above (old: f231d52d). Re-taken for NL14b2 as
 *  above (old law: 9b5c9aad). Re-taken for MP1.5b as above (old: 620028c6), and for MP5.2b as above (old: 8dd4d5a6).
 *  Restored cell positions and distance tiers as above (old: 3c9036b7). Re-taken for CC11a2c as above (old: e8e25c9d).
 *  Re-taken for NL14b1 as above (old law: c1823a44), and for CC18c as above (old: 35acd7ed). Re-taken for bb47b6afb's
 *  lip jump as above (old law: 91d1e6ce). Re-taken for the Nalati r5 pin (ONE-FORMAT OF24, shard main a1d9787): the wire
 *  and bodies hold; the seats' armed state is the new revision's (old: 603a6bb5). */
const EXPECTED_ROOM = '1f43baf30ca11257304cf1a67b2b96d40c31735e4cbe8221b18e457cac709272';
