// @vitest-environment node
import {expect, test} from 'vitest';
import {ensurePlacedHeads, type Snapshot} from '../scripts/page-release/placed-ready.mjs';

const head = {instance: 'probe', slug: 'probe', hash: 'a'.repeat(64)};
const base = [{instance: 'home', slug: 'driftwood-isle'}];
const snapshot: Snapshot = {serial: 7, cells: [...base, head]};

test('a new cell uploaded after the cut is cooked before it is accepted', async () => {
  const published = new Set<string>(), cooked: string[] = [];
  const result = await ensurePlacedHeads({base, read: () => Promise.resolve(snapshot),
    ready: row => Promise.resolve(published.has(row.hash)),
    cook: row => { cooked.push(row.hash); published.add(row.hash); return Promise.resolve(); },
  });
  expect(cooked).toEqual([head.hash]);
  expect(result).toEqual({serial: 7, heads: [head], cooked: 1});
});

test('existing exact-build indices need no cook credentials or child', async () => {
  const result = await ensurePlacedHeads({base, read: () => Promise.resolve(snapshot),
    ready: () => Promise.resolve(true), cook: () => Promise.reject(new Error('must not launch a child')),
  });
  expect(result.cooked).toBe(0);
});

test('a cook that leaves no public index cannot qualify the alias', async () => {
  await expect(ensurePlacedHeads({base, read: () => Promise.resolve(snapshot),
    ready: () => Promise.resolve(false), cook: () => Promise.resolve(),
  })).rejects.toThrow('still has no exact-build cook index');
});

test('a new raw head arriving during cooking requires another phase', async () => {
  let reads = 0, published = false;
  await expect(ensurePlacedHeads({base,
    read: () => Promise.resolve(++reads === 1 ? snapshot : {serial: 8, cells: [{...head, hash: 'b'.repeat(64)}]}),
    ready: () => Promise.resolve(published), cook: () => { published = true; return Promise.resolve(); },
  })).rejects.toThrow('Placed heads changed during readiness');
});

test('a placement without a usable head stays held instead of inventing one', async () => {
  const result = await ensurePlacedHeads({base, read: () => Promise.resolve({serial: 8, cells: [{instance: 'held', slug: 'held'}]}),
    ready: () => Promise.reject(new Error('no head to read')), cook: () => Promise.reject(new Error('no head to cook')),
  });
  expect(result.heads).toEqual([]);
});
