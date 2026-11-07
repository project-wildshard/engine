import { expect, test } from 'vitest';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { memoryWarningChip, residentOverLimit } from './memoryWarning';

test('history retains a worst-location estimate while the HUD filters it by entered shard', () => {
  const memory = new MemoryAdmission(() => true);
  memory.accept({ stage: 'actual', owner: 'pine-hollow', id: 'pine-hollow:worst-location',
    claimedBytes: 900_000_000, accountedBytes: 900_000_000,
    playingBytes: 1_340_063_000, loadingBytes: 1_500_000_000,
    playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  memory.accept({ stage: 'resident', owner: 'driftwood-isle', id: 'runtime:driftwood-isle',
    claimedBytes: 400_000_000, accountedBytes: 500_000_000,
    playingBytes: 916_000_000, loadingBytes: 1_100_000_000,
    playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  expect(memoryWarningChip(memory.reports())).toBe('MEMORY LIMIT · pine-hollow ESTIMATE · +140.1 MB');
  expect(memoryWarningChip(memory.reports(), 'driftwood-isle')).toBeNull();
  expect(memoryWarningChip(memory.reports(), 'pine-hollow')).toContain('pine-hollow ESTIMATE');
  expect(memoryWarningChip(memory.reports(), null)).toBeNull();
  // Updating resident totals must not relabel or erase the independent estimate.
  memory.syncResidents(new Set(['runtime:driftwood-isle']), () => ({
    accounted: 500_000_000, playing: 916_000_000, loading: 1_100_000_000,
    input: { l0: 0, l1: 0, far: 0, libraries: 0, sims: 0, commons: 0, products: 0, overlap: 0 },
  }));
  expect(memoryWarningChip(memory.reports())).toBe('MEMORY LIMIT · pine-hollow ESTIMATE · +140.1 MB');
  memory.dispose(); expect(memoryWarningChip(memory.reports())).toBeNull();
});

test('the chip uses the owner and stage of the largest loading or playing excess', () => {
  const memory = new MemoryAdmission(() => true);
  for (const [owner, stage, playingBytes, loadingBytes] of [
    ['first', 'actual', 1_340_000_000, 1_500_000_000],
    ['second', 'resident', 1_250_000_000, 2_000_000_000],
  ] as const) memory.accept({ stage, owner, id: owner, claimedBytes: 1, accountedBytes: 1,
    playingBytes, loadingBytes, playingCap: 1_200_000_000, loadingCap: 1_800_000_000 });
  expect(memoryWarningChip(memory.reports())).toBe('MEMORY LIMIT · second RESIDENT · +200.0 MB');
  expect(memoryWarningChip(memory.reports(), 'another-shard')).toBe('MEMORY LIMIT · second RESIDENT · +200.0 MB');
  // G628 M4: the grid's memory strip takes only the resident excess; the cold estimate is no line
  expect(residentOverLimit(memory)).toEqual([{ owner: 'second', overBytes: 200_000_000 }]);
  memory.dispose(); expect(residentOverLimit(memory)).toEqual([]);
});
