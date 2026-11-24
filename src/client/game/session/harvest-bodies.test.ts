// QA-FEEDBACK-2026-11-24 row 35 (Jake, ~14:50 Cancún: "i can no longer harvest corpses of enemies for items in driftwood"): the
// carcass prompt reads the entered grid cell's bodies, where Driftwood's kills fall; test/driftwood-harvest.test.ts proves the
// shipped island pays a killed crab's items on the claim.
import { expect, test } from 'vitest';
import { harvestBodies } from './harvestBodies';

test('standalone the page\'s bodies; in an entered grid cell that cell\'s; on the road none', () => {
  const page = ['page-crab'], cell = ['cell-crab'];
  expect(harvestBodies(true, page, () => ({ animals: cell }))).toEqual(page);
  expect(harvestBodies(false, page, () => ({ animals: cell })), 'inside the grid the kill is the entered cell\'s (it read none before)').toEqual(cell);
  expect(harvestBodies(false, page, () => null)).toEqual([]);
  expect(harvestBodies(false, page, null)).toEqual([]);
});
