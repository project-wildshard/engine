// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { questBooks } from '../src/shared/engine/quest/players';
import type { QuestView } from '../src/shared/engine/quest/viewPort';
import { QuestViewFeed } from '../src/client/engine/quest/view/replica';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { questCard } from '../src/client/game/plugin/ui';
import { QuestFlagGates } from '../src/shared/game/quest/flagGates';
import { publishBoundQuest } from '../src/shared/game/quest/boundState';
import { Flags } from '../src/shared/engine/world/interact/flags';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { Object3D } from 'three';
import { QuestState } from '../src/shared/engine/quest/core';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

// E6, QUEST: a view reads one port. The page feeds it with its own QuestState; here a NetClient feeds it over a loopback
// from Driftwood's real quest, and what a view would draw is the same, step by step, and the player's own.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
async function resident(): Promise<TrustedHeadlessResident> {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
const use = (value: number) => ({ kind: 'script' as const, actorId: 'driftwood.interact', value, playerId: 'bot:1' });
function stand(live: TrustedHeadlessResident, x: number, z: number): void {
  const bot = live.host.players.get('bot:1'); if (bot === undefined) throw new Error('No bot');
  bot.position.set(x, live.host.groundHeightAt(x, z), z); bot.motor.resetAt(bot.position);
  for (let tick = 0; tick < 3; tick++) live.step([]);
}
/** All a view draws from a quest: the chip, the MAP card, the markers, and where the quest stands. */
const drawn = (quest: QuestView) => ({ started: quest.isStarted, complete: quest.isComplete, step: quest.current?.id ?? null,
  objective: quest.objective(), hint: quest.hint(), chip: quest.chip(), card: questCard(quest), markers: quest.markers().map(marker => marker.id) });

test('a view reads the same quest from the page feed and from the wire, and only its own player\'s', async () => {
  const live = await resident(), { host } = live, spawn = leadPlayer(host).position;
  const world = new SimNetWorld(host), room = new NetRoom({ world, step: () => undefined });
  host.addPlayer('bot:1', { x: spawn.x, y: spawn.y, z: spawn.z }); host.addPlayer('bot:2', { x: spawn.x, y: spawn.y, z: spawn.z });
  const join = (id: string): { client: NetClient; link: DirectLoopback } => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.join(link.server, world.playerOf(id)); client.hello(); link.pump(); return { client, link };
  };
  const one = join('bot:1'), two = join('bot:2');
  room.open(); one.link.pump(); two.link.pump();
  const defs = host.quests.map(quest => quest.def), mine = new QuestViewFeed(defs, one.client), theirs = new QuestViewFeed(defs, two.client);
  const book = questBooks(host).of('bot:1'), found = book.quests.find(row => row.def.id === 'sealed-ring');
  if (found === undefined) throw new Error('No quest');
  const page: QuestState = found, wire = mine.quest('sealed-ring');
  const frame = (): void => { room.tick(); one.link.pump(); two.link.pump(); room.tick(); one.link.pump(); two.link.pump(); mine.sync(); theirs.sync(); };
  const onPage: string[] = [], onWire: string[] = [];
  page.observe({ step: (step, previous) => { onPage.push(`${previous?.id ?? '-'}>${step?.id ?? '-'}`); }, complete: () => { onPage.push('complete'); } });
  wire.observe({ step: (step, previous) => { onWire.push(`${previous?.id ?? '-'}>${step?.id ?? '-'}`); }, complete: () => { onWire.push('complete'); } });
  frame();
  expect(drawn(wire)).toEqual(drawn(page));

  stand(live, -22, -71.5); live.step([use(0)]); frame();
  expect(page.isStarted).toBe(true);
  expect(drawn(wire)).toEqual(drawn(page));
  expect(onWire).toEqual(onPage);
  expect(onWire.length).toBeGreaterThan(0);
  expect(drawn(theirs.quest('sealed-ring')).started, 'the other player has not started it').toBe(false);

  stand(live, -22, -62.9); live.step([use(100)]); frame();
  expect(book.flags.has('open:castaway-chest')).toBe(true);
  expect(drawn(wire)).toEqual(drawn(page));
  expect(onWire).toEqual(onPage);
  expect(mine.gates.has('open:castaway-chest'), 'J106: my gate state').toBe(true);
  expect(theirs.gates.has('open:castaway-chest'), 'J106: theirs is its own').toBe(false);
  live.dispose();
}, 60_000);

test('a page gate reads its view, so a client\'s own phase decides what it walks into', () => {
  const scope = new Scope('quest-view-port'), flags = new Flags('quest-view-port', false), registry = new WorldRegistry();
  publishBoundQuest(scope, new QuestState({ id: 'q', title: 'Q', completeFlag: 'done', steps: [] }, flags, undefined, scope));
  registry.add({ id: 'door', name: 'Door', category: 'props', file: 'test', colliders: [], follows: new Object3D() });
  const owner = { scope, game: { runtime: { world: { registry } } } }, phased = new Set<string>();
  const rows = { quest: 'q', gates: [{ id: 'door.bar', target: { kind: 'piece', piece: 'door' }, opensWhen: { all: ['open:door'] } }] };
  new QuestFlagGates(owner, rows, false, { has: flag => phased.has(flag) });
  const gate = registry.get('door.bar');
  expect(gate?.active?.()).toBe(true);
  flags.set('open:door');
  expect(gate?.active?.(), 'the page\'s own flags do not decide it: the view does').toBe(true);
  phased.add('open:door');
  expect(gate?.active?.()).toBe(false);
  scope.dispose();
});
