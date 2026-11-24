// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import type { QuestState } from '../src/shared/engine/quest/core';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { decodeSimSnapshot, serializeSimSnapshot, SIM_SNAPSHOT_VERSION, snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { DeclaredQuests } from '../src/shared/game/quest/declared';
import { InteractionRules, parseInteractionRows, playerInteractionRules } from '../src/shared/game/quest/interactionRows';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3.3: quest state is per player. Each player's book is its own over the world's flags; the lead's is the host's.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const QUESTS = { flags: ['been:there', 'dead:wolf', 'quest:walk', 'told:elder'], quests: [{ id: 'walk', title: 'A walk', steps: [{ id: 'there', objective: 'Go there', done: { all: ['been:there'] } }, { id: 'kill', objective: 'Wait for the wolf', done: { all: ['dead:wolf'] } }],
  completeFlag: 'quest:walk', onComplete: { fact: 'walked', coins: 3 } }],
  triggers: [{ id: 'there', kind: 'region' as const, flag: 'been:there', x: 40, z: 0, radius: 2 }],
  dialogue: [{ id: 'elder', name: 'Elder', start: 'hello', nodes: [{ id: 'hello', lines: ['Hello'], choices: [{ id: 'bye', label: 'Bye', next: null, sets: ['told:elder'] }] }] }] };
interface Paid { readonly kind: string; readonly name: string; readonly entity: string }
function room(level = SIM_LEVEL): { host: SimHost; paid: Paid[]; quests: DeclaredQuests } {
  const host = createSimHost(level, { rapier }), paid: Paid[] = [];
  const quests = new DeclaredQuests(host, QUESTS, { fact: (name, entity) => { paid.push({ kind: 'fact', name, entity }); }, coins: (amount, entity) => { paid.push({ kind: 'coins', name: String(amount), entity }); } });
  return { host, paid, quests };
}
const walk = (quests: readonly QuestState[]): QuestState | undefined => quests.find(quest => quest.def.id === 'walk');
const put = (host: SimHost, id: string, x: number): void => { const body = host.players.get(id); if (body === undefined) throw new Error(`No ${id}`); body.position.x = x; body.motor.resetAt(body.position); };

test('a player who walks into a region raises its own flag, and no one else\'s', () => {
  const { host } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), books = questBooks(host);
  put(host, bot.id, 40); host.step();
  expect(books.of(bot.id).flags.has('been:there')).toBe(true);
  expect(walk(books.of(bot.id).quests)?.current?.id).toBe('kill');
  expect(host.flags.has('been:there')).toBe(false);
  expect(walk(host.quests)?.current?.id).toBe('there');
  expect(books.lead.flags).toBe(host.questFlags); // SB34b: the host's flags, but its kill credit is its own
});

test('a death everyone present was credited with finishes their quests, and finishing pays the player who finished', () => {
  const { host, paid } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), books = questBooks(host);
  put(host, bot.id, 40); host.step();
  // SB34a: a death no body claims (a scripted flag) is credit for everyone present, at the next tick
  host.flags.set('dead:wolf'); host.step(); host.step();
  expect(walk(books.of(bot.id).quests)?.isComplete).toBe(true);
  expect(books.of(bot.id).flags.has('quest:walk')).toBe(true);
  expect(host.flags.has('quest:walk')).toBe(false);
  expect(paid).toEqual([{ kind: 'fact', name: 'walked', entity: 'bot:1:walk' }, { kind: 'coins', name: '3', entity: 'bot:1' }]);
  put(host, leadPlayer(host).id, 40); host.step();
  expect(paid.slice(2)).toEqual([{ kind: 'fact', name: 'walked', entity: 'walk' }, { kind: 'coins', name: '3', entity: leadPlayer(host).id }]);
});

test('a player\'s dialogue is its own', () => {
  const { host, quests } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), books = questBooks(host);
  quests.choose('elder', 'bye', bot.id);
  expect(quests.view('elder', bot.id)).toBeNull();
  expect(quests.view('elder')?.id).toBe('hello');
  expect(books.of(bot.id).flags.has('told:elder')).toBe(true);
  expect(host.flags.has('told:elder')).toBe(false);
});

test('another player\'s book survives a save, and a player who leaves takes theirs', () => {
  const { host, quests } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 });
  put(host, bot.id, 40); host.step(); quests.choose('elder', 'bye', bot.id);
  const saved = snapshotSimHost(host);
  expect(saved.books?.map(row => [row.player, row.flags])).toEqual([['bot:1', ['been:there', 'told:elder']]]);
  let again: DeclaredQuests | undefined;
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => { again = new DeclaredQuests(fresh, QUESTS, { fact: () => undefined, coins: () => undefined }); });
  const book = questBooks(restored).of(bot.id);
  expect(walk(book.quests)?.current?.id).toBe('kill');
  expect(again?.view('elder', bot.id)).toBeNull();
  expect(again?.view('elder')?.id).toBe('hello');
  expect(snapshotSimHost(restored).books).toEqual(saved.books);
  restored.removePlayer(bot.id); restored.step();
  expect(snapshotSimHost(restored).books).toBeUndefined();
});

test('a room of one saves exactly what it did', () => {
  const { host } = room();
  put(host, leadPlayer(host).id, 40); host.step();
  const saved = snapshotSimHost(host);
  expect('books' in saved).toBe(false);
  expect(saved.flags).toContain('been:there');
});

test('a graph and its interaction step give a player one set of rules', () => {
  const { host } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 });
  const rules = new InteractionRules(host.flags, parseInteractionRows({ marks: [{ id: 'held' }], rows: [{ id: 'talk', act: 1, at: 'spot', sets: ['talked:elder'] }] }));
  const first = playerInteractionRules(host, rules), second = playerInteractionRules(host, rules);
  expect(first(bot.id)).toBe(second(bot.id));
  first(bot.id).run('talk');
  expect(second(bot.id).has('talked:elder')).toBe(true);
  expect(snapshotSimHost(host).books?.[0]?.parts['marks:talk']).toBeDefined();
});

// SB34a (J106, J105, Q-CC36): a kill is credit in the book of each player who helped, never the room's for everyone.
const CAMP = { flags: ['dead:boar:1', 'quest:camp'], quests: [{ id: 'camp', title: 'Clear the camp', steps: [{ id: 'boar', objective: 'Kill the boar', done: { all: ['dead:boar:1'] } }],
  completeFlag: 'quest:camp', onComplete: { coins: 5 } }], triggers: [], dialogue: [] };
const strike = (host: SimHost, by: string, amount: number): void => {
  const body = host.entities.get('boar:1'), source = host.players.get(by);
  if (body === undefined || source === undefined) throw new Error('Missing fixture');
  host.combat.hit({ source: source.health, sourceTags: [], target: body.combatActor(), amount, point: new Vector3(), dir: new Vector3() });
  host.step();
};
const camp = (quests: readonly QuestState[]): QuestState | undefined => quests.find(quest => quest.def.id === 'camp');

test('only the player who killed moves its camp step and bounty; one who stood by gets no credit', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), paid: [string, number][] = [];
  new DeclaredQuests(host, CAMP, { coins: (amount, entity) => { paid.push([entity, amount]); } });
  const bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), books = questBooks(host), lead = leadPlayer(host).id;
  strike(host, bot.id, 1000);
  expect(host.flags.has('dead:boar:1'), 'the world keeps its record').toBe(true);
  expect(camp(books.of(bot.id).quests)?.isComplete).toBe(true);
  expect(books.of(bot.id).flags.has('dead:boar:1')).toBe(true);
  expect(paid, 'the lead stood by too (SB34b)').toEqual([[bot.id, 5]]);
  expect(books.lead.flags.has('dead:boar:1')).toBe(false);
  expect(camp(host.quests)?.current?.id).toBe('boar');
  // a second seat that stood by is told nothing of it
  const idle = host.addPlayer('bot:2', { x: 0, y: 1, z: 0 }); host.step();
  expect(books.of(idle.id).flags.has('dead:boar:1')).toBe(false);
  expect(camp(books.of(idle.id).quests)?.current?.id).toBe('boar');
  expect(questBooks(host).progressOf(idle.id, -1)?.flags).not.toContain('dead:boar:1');
  expect(questBooks(host).progressOf(bot.id, -1)?.flags).toContain('dead:boar:1');
  expect(lead).toBe('actor.player');
});

test('every player with a meaningful share of the damage is credited, and a second seat\'s old save keeps what it read', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), paid: [string, number][] = [];
  new DeclaredQuests(host, CAMP, { coins: (amount, entity) => { paid.push([entity, amount]); } });
  const one = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), two = host.addPlayer('bot:2', { x: 0, y: 1, z: 0 }), books = questBooks(host);
  strike(host, one.id, 30); strike(host, two.id, 200);
  expect([one.id, two.id].map(id => books.of(id).flags.has('dead:boar:1'))).toEqual([true, true]);
  expect(paid.map(([entity]) => entity).sort()).toEqual([one.id, two.id]);
  const saved = snapshotSimHost(host);
  expect(saved.books?.every(book => book.credited === true)).toBe(true);
  // a save from before SB34a: its books read the world's deaths, so they keep reading them
  const legacy = { ...saved, books: (saved.books ?? []).map(({ credited: _, ...book }) => ({ ...book, flags: book.flags.filter(flag => !flag.startsWith('dead:')) })) };
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, legacy, fresh => { new DeclaredQuests(fresh, CAMP, { coins: () => undefined }); });
  expect(questBooks(restored).of(one.id).flags.has('dead:boar:1')).toBe(true);
  expect(camp(questBooks(restored).of(one.id).quests)?.isComplete).toBe(true);
});

test('the lead\'s kills are its own credit, and a one-player room saves exactly what it did', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), paid: [string, number][] = [];
  new DeclaredQuests(host, CAMP, { coins: (amount, entity) => { paid.push([entity, amount]); } });
  strike(host, leadPlayer(host).id, 1000);
  expect(paid).toEqual([[leadPlayer(host).id, 5]]);
  expect(questBooks(host).lead.flags.has('dead:boar:1')).toBe(true);
  // alone, the lead's credit is the world's record, so the save has no field of its own
  const saved = snapshotSimHost(host);
  expect('credit' in saved).toBe(false);
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => { new DeclaredQuests(fresh, CAMP, { coins: () => undefined }); });
  expect(restored.questFlags.credit).toEqual(['dead:boar:1']);
  expect(camp(restored.quests)?.isComplete).toBe(true);
});

test('a lead who stood by has no credit, through a save', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  new DeclaredQuests(host, CAMP, { coins: () => undefined });
  const bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 });
  strike(host, bot.id, 1000);
  const saved = snapshotSimHost(host);
  expect(saved.credit).toEqual([]);
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => { new DeclaredQuests(fresh, CAMP, { coins: () => undefined }); });
  expect(restored.flags.has('dead:boar:1')).toBe(true);
  expect(questBooks(restored).lead.flags.has('dead:boar:1')).toBe(false);
  expect(camp(restored.quests)?.current?.id).toBe('boar');
});

test('a version 3 save on the wire reads up: the lead\'s credit is the world\'s deaths, and an unmarked book reads them once', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  new DeclaredQuests(host, CAMP, { coins: () => undefined });
  const bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 });
  strike(host, bot.id, 1000);
  const wire = JSON.parse(serializeSimSnapshot(snapshotSimHost(host))) as { version: number; snapshot: Record<string, unknown> & { books?: Record<string, unknown>[] } };
  expect(wire.version).toBe(SIM_SNAPSHOT_VERSION);
  // what a version 3 writer left: no credit field, unmarked books holding no deaths, the world's flag for every one
  const { credit: _credit, ...rest } = wire.snapshot;
  const old = { ...wire, version: 3, snapshot: { ...rest, version: 3, books: wire.snapshot.books?.map(({ credited: _, ...book }) => ({ ...book, flags: [] })) } };
  const restored = restoreSimHost(SIM_LEVEL, { rapier }, decodeSimSnapshot(JSON.stringify(old)), fresh => { new DeclaredQuests(fresh, CAMP, { coins: () => undefined }); });
  expect(questBooks(restored).of(bot.id).flags.has('dead:boar:1')).toBe(true);
  expect(questBooks(restored).lead.flags.has('dead:boar:1'), 'as a version 3 lead read it').toBe(true);
});

test('a death\'s other flags (a boss\'s deadFlag, a shard\'s death effect) are the killers\' credit; one no death claims is everyone\'s present', () => {
  const host = createSimHost(SIM_LEVEL, { rapier }), books = questBooks(host);
  const bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), idle = host.addPlayer('bot:2', { x: 0, y: 1, z: 0 });
  host.events.on('damage.dealt', ({ killed }) => { if (killed) host.flags.set('dead:captain'); }, host.scope); // the wake row's deadFlag
  host.events.on('actor.died', () => { host.flags.set('dead:sailor'); }, host.scope); // a death effect's flag
  strike(host, bot.id, 1000);
  expect(['dead:boar:1', 'dead:captain', 'dead:sailor'].map(flag => books.of(bot.id).flags.has(flag))).toEqual([true, true, true]);
  expect(['dead:boar:1', 'dead:captain', 'dead:sailor'].map(flag => books.of(idle.id).flags.has(flag))).toEqual([false, false, false]);
  host.flags.set('dead:chapter'); host.step();
  expect([books.lead.player, bot.id, idle.id].map(id => books.of(id).flags.has('dead:chapter'))).toEqual([true, true, true]);
});

test('a scripted victory saved before its credit lands still pays each seat once', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  const paid: string[] = [], restoredPaid: string[] = [];
  new DeclaredQuests(host, CAMP, { coins: (_amount, entity) => { paid.push(entity); } });
  const bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 });
  let restored: SimHost | undefined;
  try {
    host.onStep('scripted-victory', (_dt, sim) => { sim.flags.set('dead:boar:1'); }, undefined, 'afterBodies');
    host.step();
    expect(host.flags.has('dead:boar:1')).toBe(true);
    expect(host.questFlags.has('dead:boar:1')).toBe(false);
    const json = serializeSimSnapshot(snapshotSimHost(host));
    const saved = decodeSimSnapshot(json);
    expect(saved.pendingKillCredit).toEqual(['dead:boar:1']);
    const { snapshot } = JSON.parse(json) as { snapshot: Record<string, unknown> };
    const { pendingKillCredit: _pendingKillCredit, ...legacy } = snapshot;
    expect(decodeSimSnapshot({ format: 'sim.snapshot', version: 5, snapshot: { ...legacy, version: 5 } }).pendingKillCredit).toBeUndefined();
    restored = restoreSimHost(SIM_LEVEL, { rapier }, saved, fresh => {
      new DeclaredQuests(fresh, CAMP, { coins: (_amount, entity) => { restoredPaid.push(entity); } });
    });
    expect(restored.questFlags.has('dead:boar:1')).toBe(false);
    expect(restoredPaid).toEqual([]);
    for (let tick = 0; tick < 3; tick++) { host.step(); restored.step(); }
    expect(restoredPaid).toEqual(paid);
    expect([...restoredPaid].sort()).toEqual([leadPlayer(host).id, bot.id].sort());
    expect(restored.questFlags.has('dead:boar:1')).toBe(true);
    expect(questBooks(restored).of(bot.id).flags.has('dead:boar:1')).toBe(true);
    expect(snapshotSimHost(restored).pendingKillCredit).toBeUndefined();
  } finally { restored?.dispose(); host.dispose(); }
});
