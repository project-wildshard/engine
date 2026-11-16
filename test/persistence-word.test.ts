import { afterEach, expect, test, vi } from 'vitest';
import { persistenceEnvelope, readPersistenceWord, subscribePersistence, WORLD_STATUS_MAX_BYTES, type PersistenceWord } from '../src/shared/engine/net/persistenceWord';
import { worldReadsDevice } from '../src/shared/engine/net/deviceWord';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { PersistenceFeed } from '../src/server/host/dedicated/saves/persistenceStatus';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

const bytes = (value: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(value)).buffer;
const fact = { code: 'save-confirmed', sequence: 7, scope: 'driftwood-isle' } as const;
test('old discovery has no save claim; known facts survive while unknown or malformed facts stay absent', () => {
  expect(readPersistenceWord(bytes({ cells: 1, shards: ['fixture'], device: 1 }))).toBeNull();
  expect(readPersistenceWord(bytes({ status: { v: 1, persistence: fact } }))).toEqual(fact);
  expect(readPersistenceWord(bytes({ status: { v: 2, persistence: fact } }))).toBeNull();
  expect(readPersistenceWord(bytes({ status: { v: 1, persistence: { ...fact, code: 'raw server prose' } } }))).toBeNull();
  expect(readPersistenceWord(bytes({ status: { v: 1, persistence: { ...fact, sequence: -1 } } }))).toBeNull();
  expect(persistenceEnvelope({ v: 1, persistence: fact, future: 'x'.repeat(WORLD_STATUS_MAX_BYTES) })).toBeNull();
  expect(persistenceEnvelope({ v: 1, persistence: fact, checkpoint: { sequence: 4 } })?.persistence).toEqual(fact);
});

let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const bot of bots.splice(0)) bot.drop(); await bench?.close(); bench = undefined; });
function phone(url: string, player: string, modern = false): { readonly bot: RoomBot; readonly words: ArrayBuffer[]; readonly facts: PersistenceWord[] } {
  const bot = new RoomBot(url, 'bench', player), words: ArrayBuffer[] = [], facts: PersistenceWord[] = [];
  bots.push(bot);
  if (modern) {
    const off = subscribePersistence(listener => bot.transport.onControl(listener), value => { facts.push(value); });
    bot.transport.onClose(off);
  }
  bot.transport.onControl((control, value) => { if (control === 'world') words.push(value); });
  return { bot, words, facts };
}

test('real world sockets carry per-player facts without another device request or changing legacy play', { timeout: 60000 }, async () => {
  const feed = new PersistenceFeed();
  bench = await roomBench({ saves: { ...memoryPlayerSaves(), onSave: listener => feed.listen(listener) } });
  const first = phone(bench.url, 'device:first', true), second = phone(bench.url, 'device:second');
  expect(await first.bot.arrived()).toBe(true); expect(await second.bot.arrived()).toBe(true);
  expect(worldReadsDevice(first.words[0] ?? new ArrayBuffer(0))).toBe(true);
  expect(first.facts).toEqual([]);
  const tick = first.bot.client.latest?.tick ?? -1;
  // Transport fixture injects an explicit observed fact; persistence-status.test proves the actual database producer separately.
  feed.publish({ player: 'device:first', shard: 'driftwood-isle', sequence: 7, code: 'save-confirmed' });
  await vi.waitFor(() => { expect(first.words).toHaveLength(2); });
  const later = first.words[1] ?? new ArrayBuffer(0);
  expect(worldReadsDevice(later)).toBe(false);
  expect(readPersistenceWord(later)).toEqual(fact);
  expect(first.facts).toEqual([fact]);
  expect(JSON.parse(new TextDecoder().decode(later))).toEqual({ cells: 1, shards: ['driftwood-isle'], status: { v: 1, persistence: fact } });
  expect(second.words).toHaveLength(1);
  await vi.waitFor(() => { expect(first.bot.client.latest?.tick).toBeGreaterThan(tick); });
  expect(first.bot.closed).toBeNull(); expect(second.bot.closed).toBeNull();
  feed.publish({ player: 'device:first', shard: 'driftwood-isle', sequence: 8, code: 'save-failed' });
  await vi.waitFor(() => { expect(first.words).toHaveLength(3); });
  expect(readPersistenceWord(first.words[2] ?? new ArrayBuffer(0))?.code).toBe('save-failed');
  feed.publish({ player: 'not-connected', shard: 'driftwood-isle', sequence: 9, code: 'save-failed' });
  feed.publish({ player: 'device:first', shard: 'driftwood-isle', sequence: -1, code: 'save-failed' });
  expect(first.words).toHaveLength(3); expect(second.words).toHaveLength(1);
  for (const bot of bots.splice(0)) bot.drop();
  await bench.close(); bench = undefined;
  expect(() => { feed.publish({ player: 'device:first', shard: 'driftwood-isle', sequence: 10, code: 'save-confirmed' }); }).not.toThrow();
});
