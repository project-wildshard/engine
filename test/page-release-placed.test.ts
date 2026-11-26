// @vitest-environment node
import {expect, test} from 'vitest';
import {ensurePlacedHeads, placedIndexProblem, type Snapshot} from '../src/scripts/page-release/placed-ready.mjs';

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

test('NB4: a seeded old revision the candidate cannot open holds the alias', async () => {
  // meta NEVER-BREAK-LIVE I4: the candidate's own cook reads the exact uploaded bytes; a format it refuses never reaches goLive.
  await expect(ensurePlacedHeads({base, read: () => Promise.resolve(snapshot),
    ready: () => Promise.resolve(false), cook: row => Promise.reject(new Error(`Placed ${row.slug}: refused: format 0.0.9 is older than this engine reads`)),
  })).rejects.toThrow('refused: format');
});

test('NB4: an exact-build index qualifies only with a passing check and both tiers\' entry manifests', () => {
  const want = {build: 'b'.repeat(40), slug: head.slug, hash: head.hash};
  const tier = (name: string) => [{tier: name, set: 'entry'}, {tier: name, set: 'whole'}];
  const index = {...want, check: {pass: true}, manifests: [...tier('phone'), ...tier('desktop')]};
  expect(placedIndexProblem(index, want)).toBeNull();
  expect(placedIndexProblem({...index, manifests: tier('desktop')}, want)).toBe('no phone entry manifest');
  expect(placedIndexProblem({...index, manifests: []}, want)).toBe('no phone or desktop entry manifest');
  expect(placedIndexProblem({...index, check: {pass: false}}, want)).toBe('its check did not pass');
  expect(placedIndexProblem({...index, build: 'c'.repeat(40)}, want)).toBe('another build or head');
  expect(placedIndexProblem(null, want)).toBe('no index');
});
