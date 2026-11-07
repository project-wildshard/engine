// oxlint-disable-next-line import/no-nodejs-modules -- The fixture uses shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { QuestState } from '../src/shared/engine/quest/core';
import { questBooks } from '../src/shared/engine/quest/players';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
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
  expect(books.lead.flags).toBe(host.flags);
});

test('a world flag reaches every book, and finishing pays the player who finished', () => {
  const { host, paid } = room(), bot = host.addPlayer('bot:1', { x: 0, y: 1, z: 0 }), books = questBooks(host);
  put(host, bot.id, 40); host.step();
  host.flags.set('dead:wolf'); host.step();
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
