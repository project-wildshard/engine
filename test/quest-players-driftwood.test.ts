// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { questBooks } from '../src/shared/engine/quest/players';
import { QuestReplica } from '../src/client/engine/quest/view/replica';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

// P1-E3.3: Driftwood's real quest, in a room of two. A bot takes the same steps as the verb tape's and the quest is the
// bot's: the headless host runs it from the built product, on script commands that name the bot.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
async function resident(snapshot?: string): Promise<TrustedHeadlessResident> {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, snapshot);
}
const use = (value: number) => ({ kind: 'script' as const, actorId: 'driftwood.interact', value, playerId: 'bot:1' });
/** Stand the bot on the ground at a tape stop: the tape walks there; this test is about who the steps belong to. */
function stand(live: TrustedHeadlessResident, x: number, z: number): void {
  const bot = live.host.players.get('bot:1'); if (bot === undefined) throw new Error('No bot');
  bot.position.set(x, live.host.groundHeightAt(x, z), z); bot.motor.resetAt(bot.position);
  for (let tick = 0; tick < 3; tick++) live.step([]);
}

test('a bot plays Driftwood\'s opening, and the quest is the bot\'s alone', async () => {
  const live = await resident(), { host } = live, spawn = leadPlayer(host).position;
  host.addPlayer('bot:1', { x: spawn.x, y: spawn.y, z: spawn.z });
  const book = questBooks(host).of('bot:1'), ring = () => book.quests.find(quest => quest.def.id === 'sealed-ring'), lead = () => host.quests.find(quest => quest.def.id === 'sealed-ring');
  live.step([use(100)]);
  expect(book.flags.has('has:flint'), 'out of reach, the chest refuses').toBe(false);

  stand(live, -22, -71.5); live.step([use(0)]);
  expect(book.flags.has('talked:castaway')).toBe(true);
  expect(ring()?.isStarted).toBe(true);

  stand(live, -22, -62.9); live.step([use(100)]);
  expect(book.flags.has('open:castaway-chest')).toBe(true);
  expect(book.flags.has('has:flint')).toBe(true);
  const opened = book.flags.all.length;
  live.step([use(100)]);
  expect(book.flags.all.length, 'a second use cannot repeat the chest').toBe(opened);

  expect(lead()?.isStarted).toBe(false);
  expect(host.flags.has('talked:castaway')).toBe(false);
  expect(host.flags.has('open:castaway-chest')).toBe(false);
  expect(host.flags.has('has:flint')).toBe(false);

  const saved = snapshotSimHost(host);
  expect(saved.books?.[0]?.flags).toEqual(expect.arrayContaining(['talked:castaway', 'open:castaway-chest', 'has:flint']));
  live.dispose();
}, 60_000);

test('a client reads the same quest the server holds, and only its own', async () => {
  const live = await resident(), { host } = live, spawn = leadPlayer(host).position;
  const world = new SimNetWorld(host), room = new NetRoom({ world, step: () => undefined });
  host.addPlayer('bot:1', { x: spawn.x, y: spawn.y, z: spawn.z }); host.addPlayer('bot:2', { x: spawn.x, y: spawn.y, z: spawn.z });
  const join = (id: string): { client: NetClient; link: DirectLoopback } => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.join(link.server, world.playerOf(id)); client.hello(); link.pump(); return { client, link };
  };
  const one = join('bot:1'), two = join('bot:2');
  room.open(); one.link.pump(); two.link.pump();
  const defs = host.quests.map(quest => quest.def), view = new QuestReplica(defs, one.client.quests), other = new QuestReplica(defs, two.client.quests);
  const book = questBooks(host).of('bot:1'), server = () => { const quest = book.quests.find(row => row.def.id === 'sealed-ring'); if (quest === undefined) throw new Error('No quest'); return quest; };
  const frame = (): void => { room.tick(); one.link.pump(); two.link.pump(); };
  frame(); frame();
  expect(view.isStarted('sealed-ring')).toBe(false);
  expect(view.objective('sealed-ring')).toBe(server().objective());

  stand(live, -22, -71.5); live.step([use(0)]); frame(); frame();
  expect(view.isStarted('sealed-ring')).toBe(true);
  expect(view.objective('sealed-ring')).toBe(server().objective());
  expect(view.chip('sealed-ring')).toEqual(server().chip());
  expect(view.hint('sealed-ring')).toBe(server().hint());
  expect(other.isStarted('sealed-ring'), 'another player\'s client hears nothing of it').toBe(false);
  live.dispose();
}, 60_000);

test('each client sees its own world: a flag that shapes it reaches only its owner', async () => {
  const live = await resident(), { host } = live, spawn = leadPlayer(host).position;
  const world = new SimNetWorld(host), room = new NetRoom({ world, step: () => undefined });
  host.addPlayer('bot:1', { x: spawn.x, y: spawn.y, z: spawn.z }); host.addPlayer('bot:2', { x: spawn.x, y: spawn.y, z: spawn.z });
  const join = (id: string): { client: NetClient; link: DirectLoopback } => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.join(link.server, world.playerOf(id)); client.hello(); link.pump(); return { client, link };
  };
  const one = join('bot:1'), two = join('bot:2');
  room.open(); one.link.pump(); two.link.pump();
  stand(live, -22, -71.5); live.step([use(0)]); stand(live, -22, -62.9); live.step([use(100)]);
  room.tick(); one.link.pump(); two.link.pump(); room.tick(); one.link.pump(); two.link.pump();
  expect(one.client.phased.has('open:castaway-chest')).toBe(true);
  expect(two.client.phased.has('open:castaway-chest')).toBe(false);
  live.dispose();
}, 60_000);
