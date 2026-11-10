import { expect, test, vi } from 'vitest';
import { Flags } from '../src/shared/engine/world/interact/flags';
import { forgetServerInstance, readServerSites, type IndexedSaves } from '../src/client/engine/saves/indexed';
import { QuestViewFeed } from '../src/client/engine/quest/view/replica';
import type { QuestDef } from '../src/shared/engine/quest/core';
import type { QuestProgress } from '../src/shared/engine/quest/progress';
import { netInteractCommands } from '../src/shared/host/standalone/netInput';
import type { ActRoutes } from '../src/shared/engine/sim/actRoutes';

// J130: what a page on the row leans on, without a page.
function following(): { book: Flags; wished: string[]; heard: [string, boolean][] } {
  const book = new Flags('wire-test', false), wished: string[] = [], heard: [string, boolean][] = [];
  book.follow(flag => { wished.push(flag); });
  book.onChange((flag, on) => { heard.push([flag, on]); });
  return { book, wished, heard };
}

test('a following book takes the server\'s flags and tells its listeners once', () => {
  const { book, heard } = following();
  book.mirror(new Set(['a']), 1); book.mirror(new Set(['a']), 2);
  expect(book.has('a')).toBe(true);
  book.mirror(new Set(), 3);
  expect(book.has('a')).toBe(false);
  expect(heard).toEqual([['a', true], ['a', false]]);
});

test('a page write stands until the server has had time to answer, then the server wins', () => {
  const { book, wished, heard } = following();
  book.mirror(new Set(), 100);
  book.set('seen:cove');
  expect(wished).toEqual(['seen:cove']);
  book.mirror(new Set(), 160);
  expect(book.has('seen:cove')).toBe(true);
  book.mirror(new Set(), 300);
  expect(book.has('seen:cove')).toBe(false);
  expect(heard).toEqual([['seen:cove', true], ['seen:cove', false]]);
});

test('a page write the server answers stays, with no second beat', () => {
  const { book, heard } = following();
  book.mirror(new Set(), 100);
  book.set('open:hold');
  book.mirror(new Set(['open:hold']), 110); book.mirror(new Set(['open:hold']), 400);
  expect(heard).toEqual([['open:hold', true]]);
});

test('a crossing restarts the frame clock and no page write sticks', () => {
  const { book } = following();
  book.mirror(new Set(), 90_000);
  book.set('seen:road');
  book.mirror(new Set(), 3);
  expect(book.has('seen:road')).toBe(false);
});

const quest: QuestDef = { id: 'q', title: 'Q', completeFlag: 'done', steps: [{ id: 'one', objective: 'One', chip: 'One', hint: 'h', done: { all: ['x'] } }] };
test('what a save opened with is no news; what changes after it is', () => {
  const quests = new Map<string, QuestProgress>(), feed = new QuestViewFeed([quest], { quests, phased: new Set() }), view = feed.quest('q'), told: string[] = [];
  view.observe({ step: step => { told.push(step?.id ?? 'none'); }, complete: () => { told.push('done'); } });
  quests.set('q', { quest: 'q', started: true, step: 'one', n: 0 });
  feed.settle(); feed.sync();
  expect(told).toEqual([]);
  quests.set('q', { quest: 'q', started: true, step: null, n: 0 });
  feed.sync();
  expect(told).toEqual(['done', 'none']);
});

test('New Game forgets every world and site of its instance, and no other', async () => {
  const documents = new Map([
    ['w.standalone-a', '{}'], ['w.standalonealt-a', '{}'], ['w.standalone-lone-a', '{}'], ['w.standalone-b', '{}'],
    ['w.standalonesite-grid', JSON.stringify({ keys: { continuationSite: { v: 1, data: { tick: 1, site: 'a' } } } })],
    ['w.standalonesitealt-grid', JSON.stringify({ keys: { continuationSite: { v: 1, data: { tick: 1, site: 'b' } } } })],
    ['w.a', '{"keys":{}}'], ['w.profile', '{}'],
  ]);
  const saves: IndexedSaves = { write: (key, value) => { if (value === null) documents.delete(key); else documents.set(key, value); return Promise.resolve(true); },
    storage: { get length() { return documents.size; }, key: index => [...documents.keys()][index] ?? null, getItem: key => documents.get(key) ?? null, setItem: () => undefined, removeItem: () => undefined } };
  expect(await forgetServerInstance(saves, 'w.', 'a')).toBe(true);
  expect([...documents.keys()].sort()).toEqual(['w.a', 'w.profile', 'w.standalone-b', 'w.standalonesitealt-grid']);
});

test('SR4: a page reads where the server durably stands from the two grid site documents alone, newest first', async () => {
  const site = (tick: number, at: string | null): string => JSON.stringify({ keys: { continuationSite: { v: 1, data: { tick, site: at, road: 'bytes' } } } });
  const documents = new Map([['w.standalonesite-grid', site(6, null)], ['w.standalonesitealt-grid', site(7, 'open-plot-4-1')], ['w.standalonesite-lone-a', site(9, 'a')]]);
  const asked: string[] = [], closed = vi.fn();
  const request = <T>(result: T): { result: T; onsuccess?: () => void } => { const made: { result: T; onsuccess?: () => void } = { result }; queueMicrotask(() => { made.onsuccess?.(); }); return made; };
  const database = { close: closed, transaction: () => ({ objectStore: () => ({ get: (key: string) => { asked.push(key); return request(documents.get(key)); } }) }) };
  const before = Reflect.get(globalThis, 'indexedDB');
  Reflect.set(globalThis, 'indexedDB', { open: () => request(database) });
  try {
    expect(await readServerSites('w.', 'db')).toEqual([{ tick: 7, site: 'open-plot-4-1' }, { tick: 6, site: null }]);
    expect(asked).toEqual(['w.standalonesite-grid', 'w.standalonesitealt-grid']);
    documents.set('w.standalonesitealt-grid', '{not json'); documents.delete('w.standalonesite-grid');
    expect(await readServerSites('w.', 'db')).toEqual([]);
    expect(closed).toHaveBeenCalledTimes(2);
  } finally { Reflect.set(globalThis, 'indexedDB', before); }
});

test('a seen act lands on the host that keeps places, and costs a host with none only a refusal', () => {
  const seen: string[] = [], routes: ActRoutes = { identities: new Map(), time: null, inside: null, tied: null, interactions: new Map(), poseInputs: new Set<string>(), equip: null, lock: null, ride: null, mountable: null, story: null, bonded: null, lean: null, launcher: null, seen: null, buy: null, board: null, wear: null, climate: null, claims: new Map(), skipHeld: false, refused: 0 };
  expect(netInteractCommands(routes, [{ kind: 'interact', seq: 1, id: 'seen:cove' }], 'p')).toEqual([]);
  expect(routes.refused).toBe(1);
  routes.seen = (player, flag) => { seen.push(`${player} ${flag}`); };
  netInteractCommands(routes, [{ kind: 'interact', seq: 2, id: 'seen:cove' }], 'p');
  expect(seen).toEqual(['p seen:cove']);
  expect(routes.refused).toBe(1);
});
