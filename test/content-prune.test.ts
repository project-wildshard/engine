// Fix preview PV15: who reads a packs content set or a C8 leftover, and what a delete run takes. Tiny made-up
// buckets and pages only (J507): no zone, no live listing.
import { expect, test } from 'vitest';
import {
  STATE_KEY, UNREAD_MS, carriedContentBuilds, channelReaders, parseState, prune, readersOf, report, selectDeletes, unitsOf,
  type ChannelReaders, type PacksBucket,
} from '../src/scripts/content-prune.mjs';

const A = 'aaaaaaaaaaaaaaaa', B = 'bbbbbbbbbbbbbbbb', C = 'cccccccccccccccc';
const PACKS = 'https://packs.wildshard.io';
const page = (base?: string): string => `<html><script type="application/json" id="boot-module-files">${JSON.stringify(base === undefined ? {} : { contentBase: base })}</script></html>`;
const graph = (...builds: { build: string; content?: true }[]) => ({ format: 2, builds: builds.map(build => ({ files: ['a.js'], ...build })) });
const quiet = (channel: string, base?: string): ChannelReaders => channelReaders(channel, page(base), graph({ build: `${channel}-new` }));
const HOUR = 3_600_000, NOW = Date.parse('2026-11-28T12:00:00Z');

/** An in-memory bucket with the PacksBucket shape; `removed` records every delete. */
function bucket(keys: Record<string, string>) {
  const objects = new Map(Object.entries(keys)), removed: string[] = [], writes: string[] = [];
  const store: PacksBucket = {
    children: async prefix => {
      const prefixes = new Set<string>(), direct: string[] = [];
      for (const key of objects.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length), slash = rest.indexOf('/');
        if (slash < 0) direct.push(key); else prefixes.add(prefix + rest.slice(0, slash + 1));
      }
      return { prefixes: [...prefixes].sort(), keys: direct.sort() };
    },
    size: async prefix => {
      const rows = [...objects].filter(([key]) => key.startsWith(prefix));
      return { objects: rows.length, bytes: rows.reduce((sum, [, body]) => sum + body.length, 0) };
    },
    keys: async prefix => [...objects.keys()].filter(key => key.startsWith(prefix)).sort(),
    text: async key => objects.get(key),
    write: async (key, body) => { writes.push(key); objects.set(key, body); },
    remove: async prefix => {
      if (prefix.startsWith('assets/') || prefix.startsWith('index/') || prefix.startsWith('loose/')) throw new Error(`Refusing to delete ${prefix}`);
      let count = 0, bytes = 0;
      for (const [key, body] of [...objects]) if (key.startsWith(prefix)) { objects.delete(key); count++; bytes += body.length; }
      removed.push(prefix);
      return { objects: count, bytes };
    },
  };
  return { store, objects, removed, writes };
}

const filled = () => bucket({
  [`content/${A}/content.json`]: '{}', [`content/${A}/assets/a.webp`]: 'aaaa',
  [`content/${B}/content.json`]: '{}', [`content/${B}/shardfiles/x/shard.json`]: 'bb',
  'shardfiles/old-zone/shard.json': '{}', 'programs/old-zone.json': '{}',
  'assets/old-zone/far.png': 'png', 'assets/spawn/server-1.json': '{}', 'loose/abc/shardfiles/x.json': '{}',
  [`index/build1/${'1'.repeat(64)}.json`]: JSON.stringify({ keys: ['assets/old-zone/far.png', 'loose/abc/shardfiles/x.json'] }),
});

test('a retained format-2 build that read a set keeps every set and leftover; format 1 retains none', () => {
  expect(carriedContentBuilds({ format: 1, build: 'b1', files: [] })).toEqual([]);
  expect(carriedContentBuilds(graph({ build: 'new' }, { build: 'old', content: true }))).toEqual(['old']);
  expect(() => carriedContentBuilds({ format: 2, builds: [{ build: 'x', files: [], content: false }] })).toThrow(/Cannot verify/u);
  expect(() => carriedContentBuilds({ format: 3 })).toThrow(/Cannot verify/u);
  const units = unitsOf({ sets: [A, B], shardfiles: ['old-zone'], programs: true });
  expect(units.map(unit => unit.key)).toEqual([`content/${A}/`, `content/${B}/`, 'shardfiles/old-zone/', 'programs/']);
  const carried = channelReaders('staging', page(), graph({ build: 'new' }, { build: 'old', content: true }));
  for (const { readBy } of readersOf(units, [carried, quiet('production')], new Set())) {
    expect(readBy).toEqual(['staging: retained build old reads an unnamed content set (format 2)']);
  }
});

test('a live page keeps only its own set; a root base keeps the leftovers; an unknown packs base keeps all', () => {
  const units = unitsOf({ sets: [A, B], shardfiles: ['old-zone'], programs: true });
  const read = (readers: ChannelReaders[], named = new Set<string>()) =>
    Object.fromEntries(readersOf(units, readers, named).map(({ unit, readBy }) => [unit.key, readBy.length]));
  expect(read([quiet('preview', `${PACKS}/content/${A}/`), quiet('staging')]))
    .toEqual({ [`content/${A}/`]: 1, [`content/${B}/`]: 0, 'shardfiles/old-zone/': 0, 'programs/': 0 });
  expect(read([quiet('preview', `${PACKS}/`)]))
    .toEqual({ [`content/${A}/`]: 2, [`content/${B}/`]: 2, 'shardfiles/old-zone/': 2, 'programs/': 2 });
  expect(Object.values(read([quiet('preview', `${PACKS}/content/elsewhere/`)]))).toEqual([1, 1, 1, 1]);
  // a page on its own origin reads nothing here
  expect(Object.values(read([quiet('preview', 'https://preview.wildshard.io/')]))).toEqual([0, 0, 0, 0]);
  // a cook index naming a key under a leftover keeps that leftover only
  expect(read([quiet('staging')], new Set(['programs/old-zone.json', 'assets/x.png'])))
    .toEqual({ [`content/${A}/`]: 0, [`content/${B}/`]: 0, 'shardfiles/old-zone/': 0, 'programs/': 1 });
});

test('a unit is deleted only when a run a day earlier saw it unread too', () => {
  const set = { key: `content/${A}/`, kind: 'set' as const }, other = { key: `content/${B}/`, kind: 'set' as const };
  const left = { key: 'programs/', kind: 'leftover' as const };
  const first = selectDeletes([{ unit: set, readBy: [] }, { unit: other, readBy: ['staging: live'] }], { format: 1, unread: {} }, NOW);
  expect(first.deletes).toEqual([]);
  expect(first.state).toEqual({ format: 1, unread: { [set.key]: new Date(NOW).toISOString() } });
  const later = selectDeletes([{ unit: set, readBy: [] }, { unit: left, readBy: [] }], first.state, NOW + UNREAD_MS - HOUR);
  expect(later.deletes).toEqual([]);
  const day = selectDeletes([{ unit: set, readBy: [] }, { unit: left, readBy: [] }], later.state, NOW + UNREAD_MS);
  expect(day.deletes).toEqual([set]);
  expect(day.waiting.map(row => row.unit)).toEqual([left]);
  // read again: the clock restarts
  const reread = selectDeletes([{ unit: set, readBy: ['preview: live page'] }], day.state, NOW + 2 * UNREAD_MS);
  expect(reread).toEqual({ deletes: [], waiting: [], state: { format: 1, unread: {} } });
  expect(() => parseState({ format: 1, unread: { x: 'soon' } })).toThrow(/has no time/u);
  expect(() => parseState({ unread: {} })).toThrow(/format 1/u);
});

test('a dry run writes and deletes nothing; delete runs take unread units after a day and never the cook\'s', async () => {
  const { store, objects, removed, writes } = filled();
  const readers = async () => [quiet('preview', `${PACKS}/content/${A}/`), quiet('staging')];
  const dry = await prune({ bucket: store, readers, now: NOW, sizes: true });
  expect(dry.dryRun).toBe(true);
  expect(writes).toEqual([]);
  expect(removed).toEqual([]);
  expect(dry.unknown).toEqual([]);
  expect(dry.sizes[`content/${A}/`]).toEqual({ objects: 2, bytes: 6 });
  expect(dry.sizes['assets/old-zone/']).toEqual({ objects: 1, bytes: 3 });
  expect(report(dry)).toContain('content sets: 2 (1 read, 1 unread), 4 objects, 0.00 GB');
  expect(report(dry)).toContain('1 cook indexes read; dry run: nothing written or deleted');
  // first delete run: starts the clock, deletes nothing
  const first = await prune({ bucket: store, readers, now: NOW, remove: true });
  expect(first.deleted).toEqual([]);
  expect(writes).toEqual([STATE_KEY]);
  expect(Object.keys(parseState(JSON.parse(objects.get(STATE_KEY) ?? '')).unread).sort()).toEqual([`content/${B}/`, 'programs/', 'shardfiles/old-zone/']);
  // a day later: the unread set and leftovers go; the live set, the cook's art and its index stay
  const day = await prune({ bucket: store, readers, now: NOW + UNREAD_MS, remove: true });
  expect(removed).toEqual([`content/${B}/`, 'shardfiles/old-zone/', 'programs/']);
  expect(day.deleted.map(row => row.key)).toEqual(removed);
  expect([...objects.keys()].filter(key => key !== STATE_KEY).sort()).toEqual([
    'assets/old-zone/far.png', 'assets/spawn/server-1.json', `content/${A}/assets/a.webp`, `content/${A}/content.json`,
    `index/build1/${'1'.repeat(64)}.json`, 'loose/abc/shardfiles/x.json',
  ]);
  expect(parseState(JSON.parse(objects.get(STATE_KEY) ?? '')).unread).toEqual({});
});

test('a channel that cannot be read stops the run before any write or delete', async () => {
  const { store, removed, writes } = filled();
  await expect(prune({ bucket: store, readers: () => Promise.reject(new Error('staging /deploy-chunks.json HTTP 503')), now: NOW, remove: true }))
    .rejects.toThrow(/HTTP 503/u);
  expect([removed, writes]).toEqual([[], []]);
  // an unknown root prefix is reported, never deleted
  const odd = bucket({ 'mystery/x.bin': '1', [`content/${C}/content.json`]: '{}' });
  const result = await prune({ bucket: odd.store, readers: async () => [quiet('staging')], now: NOW });
  expect(result.unknown).toEqual(['mystery/']);
});
