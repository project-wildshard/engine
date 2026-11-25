// ONE-FORMAT OF30: a native roster and ground boss read their species from the declared rows (FORMAT-PRUNE FP20: the
// programme section they once matched is deleted).
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { declaredBossProgram, declaredHarvest, declaredRosterPopulation } from '../src/server/game/population/declaredNative';
import { builtFolder } from '../src/test/game/builtFolder';

test('a declared product restores an older carcass by one declared harvest per kind', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow'));
  const harvest = declaredHarvest(product.shardfile.rows);
  expect(new Set(harvest.map(row => row.kind)).size).toBe(harvest.length);
  expect(harvest.find(row => row.kind === 'elk')?.harvest?.map(drop => drop.item)).toContain('antlers');
});

test('a roster with no programme and no named species refuses before any body', async () => {
  const product = await loadHeadlessFolder(builtFolder('pine-hollow'));
  expect(() => declaredRosterPopulation(product.shardfile.rows, product.shardfile.creatures, {})).toThrow(/names its declared species/u);
  expect(() => declaredBossProgram(product.shardfile.rows, 'antler-king', {}, [])).toThrow(/decision and body/u);
});
