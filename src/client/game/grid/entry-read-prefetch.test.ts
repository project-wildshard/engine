import { expect, test } from 'vitest';
import { entryReadPlan, prefetchEntryReads, type EntryReadPorts } from './entryReadPrefetch';
import type { EntryReadSet } from '@wildshard/format/entryReads';

const hash = (n: number): string => n.toString(16).padStart(64, '0');
const set: EntryReadSet = [
  { region: 'pine-hollow', tier: 'desktop', at: [0, 0], reads: [{ url: '/assets/pine-hollow/desk.ktx2', hash: hash(9), bytes: 9 }] },
  { region: 'pine-hollow', tier: 'phone', at: [0, 0], reads: [
    { url: `/shardfiles/pine-hollow/blobs/bin/${hash(1)}.bin`, hash: hash(1), bytes: 1 },
    { url: '/assets/pine-hollow/astc6/tex/bark-7b80dfb8.ktx2', hash: hash(2), bytes: 2 },
    { url: `/shardfiles/pine-hollow/blobs/bin/${hash(3)}.bin`, hash: hash(3), bytes: 3 },
    { url: '/assets/baked/pine-hollow/near.glb?v=11dcb0b8', hash: hash(4), bytes: 4 },
  ] },
];

test('the plan is the tier row in first-demand order, with the blobs this product still holds and every asset', () => {
  const plan = entryReadPlan(set, 'phone', 'pine-hollow', { files: [{ hash: hash(1), compressed: 1 }, { hash: hash(7), compressed: 7 }] as never });
  expect(plan.map(read => read.hash)).toEqual([hash(1), hash(2), hash(4)]);
});

const ports = (files: readonly string[], json: unknown = set, fetchJson: EntryReadPorts['fetchJson'] = () => Promise.resolve(json)): EntryReadPorts & { blobs: string[]; assets: string[] } => {
  const blobs: string[] = [], assets: string[] = [];
  return { blobs, assets, source: { files: files.map(h => ({ hash: h, compressed: Number.parseInt(h, 16) })) as never },
    readBlob: h => { blobs.push(h); return Promise.resolve(); },
    reserve: () => ({ release: () => undefined }),
    fetchAsset: read => { assets.push(read.url); return Promise.resolve(); },
    fetchJson };
};

test('a verified approach reads blobs through the product reader and assets through the HTTP cache, and counts them', async () => {
  const p = ports([hash(1), hash(3)]);
  const count = await prefetchEntryReads('pine-hollow', 'phone', p, new AbortController().signal);
  expect(count).toBe(4); expect(p.blobs.sort()).toEqual([hash(1), hash(3)]);
  expect(p.assets.sort()).toEqual(['/assets/baked/pine-hollow/near.glb?v=11dcb0b8', '/assets/pine-hollow/astc6/tex/bark-7b80dfb8.ktx2']);
});

test('a turn-away starts no read, and a missing or invalid record prefetches nothing', async () => {
  const aborted = new AbortController(); aborted.abort();
  const p = ports([hash(1), hash(3)]);
  expect(await prefetchEntryReads('pine-hollow', 'phone', p, aborted.signal)).toBe(0); expect(p.blobs).toEqual([]);
  expect(await prefetchEntryReads('pine-hollow', 'phone', ports([hash(1)], { not: 'a set' }), new AbortController().signal)).toBe(0);
  const missing = ports([hash(1)], set, () => Promise.reject(new Error('404')));
  expect(await prefetchEntryReads('pine-hollow', 'phone', missing, new AbortController().signal)).toBe(0);
});


test('turn-away drains every started read before releasing its speculative claim', async () => {
  const controller = new AbortController(), p = ports([hash(1), hash(3)]), events: string[] = [];
  let finish = (): void => undefined;
  const body = new Promise<void>(resolve => { finish = resolve; });
  const pending = prefetchEntryReads('pine-hollow', 'phone', { ...p,
    reserve: read => { events.push(`reserve:${read.hash}`); return { release: () => { events.push(`release:${read.hash}`); } }; },
    readBlob: () => body, fetchAsset: () => body,
  }, controller.signal);
  await Promise.resolve(); await Promise.resolve();
  expect(events.filter(row => row.startsWith('reserve'))).toHaveLength(3);
  controller.abort(); expect(events.filter(row => row.startsWith('release'))).toHaveLength(0);
  finish(); expect(await pending).toBe(3);
  expect(events.filter(row => row.startsWith('reserve'))).toHaveLength(3);
  expect(events.filter(row => row.startsWith('release'))).toHaveLength(3);
});

test('headroom refusal starts no body and nearest entry retains its own read order', async () => {
  const p = ports([hash(1)]), far = { region: 'near', tier: 'phone' as const, at: [50, 50] as const,
    reads: [{ url: '/assets/fixture/near.bin', hash: hash(8), bytes: 8 }] };
  expect(entryReadPlan([...set, far], 'phone', 'pine-hollow', p.source, { x: 49, z: 49 })).toEqual(far.reads);
  expect(await prefetchEntryReads('pine-hollow', 'phone', { ...p, reserve: () => null }, new AbortController().signal)).toBe(0);
  expect(p.blobs).toEqual([]); expect(p.assets).toEqual([]);
});
