import { expect, test } from 'vitest';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { contentCost } from '@wildshard/format/contentCost';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { ResidencyAllocator, shardCost } from '../../../shared/game/grid/allocator';

const limits = { playing: CONTENT_CAPS.playing, loading: CONTENT_CAPS.loading };
const world = (owner: string, bytes: number) => ({ id: `sim:${owner}`, owner, bytes, category: 'sim' as const, distance: 0, needed: true });

test('G723: an affordable kept world and incoming world pass without reserving or evicting', () => {
  const allocator = new ResidencyAllocator();
  const kept = allocator.reserve(world('kept', 100_000_000));
  if (kept === null) throw new Error('Missing kept world');
  try {
    const before = allocator.entries(), cost = allocator.cost(), reports = allocator.memory.reports();
    expect(allocator.canPrepareAlongside('kept', 'incoming', 100_000_000, limits)).toBe(true);
    expect(allocator.entries()).toEqual(before);
    expect(allocator.cost()).toEqual(cost);
    expect(allocator.memory.reports()).toEqual(reports);
  } finally { kept.release(); }
});

test('G723: page loading limit refuses preparation even when both owners separately fit', () => {
  const allocator = new ResidencyAllocator({ playing: 10e9 });
  const kept = allocator.reserve(world('kept', 700_000_000));
  if (kept === null) throw new Error('Missing kept world');
  try {
    const input = allocator.cost().input;
    expect(shardCost(700_000_000, input).playing).toBeLessThan(limits.playing);
    expect(contentCost({ ...input, sims: input.sims + 700_000_000 }).loading).toBeGreaterThan(limits.loading);
    expect(allocator.canPrepareAlongside('kept', 'incoming', 700_000_000, limits)).toBe(false);
    expect(allocator.entries().map(row => row.owner)).toEqual(['kept']);
  } finally { kept.release(); }
});

test.each(['kept', 'incoming'])('G723: the %s per-owner cap remains strict under Developer admission', owner => {
  const allocator = new ResidencyAllocator({ playing: 10e9, memory: new MemoryAdmission(() => true) });
  const kept = allocator.reserve(world('kept', owner === 'kept' ? 900_000_000 : 1));
  if (kept === null) throw new Error('Missing kept world');
  try {
    expect(allocator.canPrepareAlongside('kept', 'incoming', owner === 'incoming' ? 900_000_000 : 1, { ...limits, loading: 10e9 })).toBe(false);
    expect(allocator.entries()).toHaveLength(1);
  } finally { kept.release(); }
});

test('G723: incoming product bytes count toward its own world cap', () => {
  const allocator = new ResidencyAllocator({ playing: 10e9 });
  const kept = allocator.reserve(world('kept', 1));
  const product = allocator.reserve({ id: 'product:incoming', owner: 'incoming', category: 'product', bytes: 500_000_000, distance: 0, needed: true });
  if (kept === null || product === null) throw new Error('Missing test claims');
  try {
    expect(allocator.canPrepareAlongside('kept', 'incoming', 400_000_000, { ...limits, loading: 10e9 })).toBe(false);
  } finally { product.release(); kept.release(); }
});

test('G723: projected page loading boundary is inclusive and one byte less refuses', () => {
  const allocator = new ResidencyAllocator(), kept = allocator.reserve(world('kept', 1000));
  if (kept === null) throw new Error('Missing kept world');
  try {
    const input = allocator.cost().input;
    const loading = contentCost({ ...input, sims: input.sims + 1000 }).loading;
    expect(allocator.canPrepareAlongside('kept', 'incoming', 1000, { playing: limits.playing, loading })).toBe(true);
    expect(allocator.canPrepareAlongside('kept', 'incoming', 1000, { playing: limits.playing, loading: loading - 1 })).toBe(false);
  } finally { kept.release(); }
});

test.each([Number.NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('G723: invalid incoming bytes %s defer preparation safely', bytes => {
  const allocator = new ResidencyAllocator();
  expect(allocator.canPrepareAlongside('kept', 'incoming', bytes, limits)).toBe(false);
  expect(allocator.entries()).toEqual([]);
});
