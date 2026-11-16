// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { questBooks } from '../src/shared/engine/quest/players';
import { NetRoom, type NetTickInput } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

// P1-E5.2c: `interact` and `equip` over DirectLoopback, on shipped products, for whoever sends them. The worker's half of
// the same round trip is in test/standalone-acts.test.ts.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function resident(slug: string): Promise<TrustedHeadlessResident> {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = runtimeAssets(product, directory);
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
/** The room's step on a resident: the lead's input as tick commands, everyone else's by name. */
function stepper(live: TrustedHeadlessResident): (inputs: readonly NetTickInput[]) => void {
  const { host } = live, lead = leadPlayer(host).id;
  return inputs => {
    const own = inputs.find(row => row.player === lead), others = new Map<string, NetCommand>();
    for (const row of inputs) if (row.player !== lead && row.command !== null) others.set(row.player, row.command);
    live.step(tickCommands([{ source: 'net', commands: netTickCommands(own?.command ?? null, own?.acts ?? [], actRoutes(host)) }], 8), others, new Map(inputs.map(row => [row.player, row.acts])));
  };
}
interface Seat { readonly client: NetClient; readonly link: DirectLoopback }
function seats(live: TrustedHeadlessResident, ids: readonly string[]): { room: NetRoom; world: SimNetWorld; seated: Seat[]; run: (ticks: number) => void } {
  const world = new SimNetWorld(live.host), room = new NetRoom({ world, step: stepper(live) });
  const seated = ids.map(id => { const link = directLoopback(), client = new NetClient(link.client); room.join(link.server, world.playerOf(id)); client.hello(); link.pump(); return { client, link }; });
  room.open(); for (const seat of seated) seat.link.pump();
  const run = (ticks: number): void => {
    for (let tick = 0; tick < ticks; tick++) {
      for (const seat of seated) { seat.client.flush(); seat.link.pump(); }
      room.tick(); for (const seat of seated) seat.link.pump();
    }
  };
  return { room, world, seated, run };
}
const stand = (live: TrustedHeadlessResident, id: string, x: number, z: number): void => {
  const player = live.host.players.get(id); if (player === undefined) throw new Error('No player');
  player.position.set(x, live.host.groundHeightAt(x, z), z); player.motor.resetAt(player.position);
};

test('interact: the id a client names reaches the row for the player who sent it, and a retry repeats nothing', { timeout: 10_000 }, async () => {
  const live = await resident('driftwood-isle'), { host } = live, lead = leadPlayer(host), spawn = lead.position;
  host.addPlayer('bot:1', { x: spawn.x, y: spawn.y, z: spawn.z });
  const { room, seated: [leader, bot], run } = seats(live, [lead.id, 'bot:1']);
  if (leader === undefined || bot === undefined) throw new Error('No seats');
  const book = questBooks(host).of('bot:1');
  bot.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(3);
  expect(book.flags.has('has:flint'), 'out of reach, the chest refuses').toBe(false);
  stand(live, 'bot:1', -22, -71.5); run(2);
  bot.client.act({ kind: 'interact', seq: 0, id: 'castaway.talk' }); run(3);
  expect(book.flags.has('talked:castaway')).toBe(true);
  expect(bot.client.quests.get('sealed-ring')?.started, 'and the client that asked hears of it').toBe(true);
  stand(live, 'bot:1', -22, -62.9); run(2);
  bot.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(3);
  expect(book.flags.has('has:flint')).toBe(true);
  const held = book.flags.all.length;
  bot.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); bot.client.act({ kind: 'interact', seq: 0, id: 'castaway-chest' }); run(3);
  expect(book.flags.all.length, 'a retried act cannot repeat the chest').toBe(held);
  expect(leader.client.quests.get('sealed-ring')?.started, 'J106: the quest it moved is the bot\'s alone').not.toBe(true);
  expect(host.flags.has('has:flint')).toBe(false);
  bot.client.act({ kind: 'interact', seq: 0, id: 'no.such.row' }); run(2);
  expect(bot.client.closed).toBeNull();
  room.dispose(); live.dispose();
});

test('equip: a player picks an owned slot, and owner and others read it from the player\'s row', { timeout: 10_000 }, async () => {
  const live = await resident('pine-hollow'), { host } = live, lead = leadPlayer(host), spawn = lead.position;
  host.addPlayer('bot:1', { x: spawn.x + 1, y: spawn.y, z: spawn.z });
  const { room, seated: [leader, bot], run } = seats(live, [lead.id, 'bot:1']);
  if (leader === undefined || bot === undefined) throw new Error('No seats');
  const held = (client: NetClient): unknown => client.latest === null ? null : client.owner(client.latest)['held'];
  const seenBy = (client: NetClient, id: string): unknown => {
    const handle = [...client.entities.values()].find(entity => entity.id === id)?.handle, frame = client.latest;
    return handle === undefined || frame === null ? null : client.fields(frame, handle)?.['held'];
  };
  run(2);
  expect(held(bot.client)).toBe(0);
  bot.client.act({ kind: 'equip', seq: 1, slot: 1 }); run(30);
  expect(held(bot.client), 'an unowned slot stays shut').toBe(0);
  host.flags.set('owned:lever-rifle');
  bot.client.act({ kind: 'equip', seq: 2, slot: 1 }); run(30);
  expect(held(bot.client)).toBe(1);
  expect(seenBy(leader.client, 'bot:1')).toBe(1);
  expect(held(leader.client), 'the lead still holds its own').toBe(0);
  leader.client.act({ kind: 'equip', seq: 1, slot: 1 }); run(30);
  expect(held(leader.client)).toBe(1);
  room.dispose(); live.dispose();
});

test('a flood of acts waits its turn and cannot end the server', { timeout: 10_000 }, async () => {
  const live = await resident('sunscar-dunes'), { room, seated: [seat], run } = seats(live, [leadPlayer(live.host).id]);
  if (seat === undefined) throw new Error('No seat');
  for (let index = 0; index < 64; index++) seat.client.act({ kind: 'interact', seq: index, id: 'talk' });
  run(40);
  expect(seat.client.closed).toBeNull();
  expect(seat.client.latest).not.toBeNull();
  room.dispose(); live.dispose();
});
