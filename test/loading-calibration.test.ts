import {expect, it} from 'vitest';
import {loadingFraction} from '../src/client/engine/boot/weights';
import {loadingPath} from '../src/client/game/boot/loadingPaths';
import { timeLeftSeconds, type TimeLeftRow } from '../src/client/engine/boot/timeLeft';

it('every shipping path remains unchanged by elapsed time or former calibration history', () => {
  for (const kind of ['grid', 'shardfile', 'legacy', 'cell', 'crossing'] as const) {
    const rows = loadingPath(kind).steps.map(() => ({state: 'todo' as const, ms: 0}));
    expect(loadingFraction(rows)).toBe(0);
    expect(loadingFraction(rows.map(row => ({...row, ms: 1_000_000})))).toBe(0);
    expect(loadingFraction(rows.map(row => ({...row, state: 'ok' as const})))).toBeLessThan(1);
    expect(loadingFraction(rows, true)).toBe(1);
  }
});


const NOT_LOAD_WORK = new Set(['modules', 'finish']);
/** The grid path, its rows up to and including `through` finished at `place` between desktop (0) and phone (1). */
function gridBoot(through: string, place: number): { rows: TimeLeftRow[]; left: number } {
  const steps = loadingPath('grid').steps, at = steps.findIndex(step => step.key === through);
  let left = 0;
  const rows = steps.map((step, index): TimeLeftRow => {
    const seconds = (step.fastWeight ?? 0) + place * (step.weight - (step.fastWeight ?? 0));
    if (index > at) { if (!NOT_LOAD_WORK.has(step.key)) left += seconds; return { key: step.key, state: 'todo', ms: 0, weight: step.weight, ...(step.fastWeight === undefined ? {} : { fastWeight: step.fastWeight }) }; }
    return { key: step.key, state: 'ok', ms: seconds * 1000, weight: step.weight, ...(step.fastWeight === undefined ? {} : { fastWeight: step.fastWeight }) };
  });
  return { rows, left };
}

it('LS5: the grid path is measured on both profiles, and its time left is the rows still to run at the device\'s place', () => {
  for (const step of loadingPath('grid').steps) {
    expect(step.weight, step.key).toBeGreaterThanOrEqual(0);
    expect(step.fastWeight, step.key).toBeGreaterThanOrEqual(0);
  }
  for (const place of [0, 0.5, 1]) {
    const { rows, left } = gridBoot('home', place);
    expect(timeLeftSeconds(rows)).toBeCloseTo(left, 6);
  }
  // before a second of phone-profile work has finished there is no reading: the card hides it
  expect(timeLeftSeconds(gridBoot('loadout', 1).rows)).toBeNull();
});

it('LS5: a path measured on one profile, or not at all, shows no time left', () => {
  for (const id of ['shardfile', 'legacy', 'cell', 'crossing'] as const) {
    const rows = loadingPath(id).steps.map((step): TimeLeftRow => ({ key: step.key, state: 'ok', ms: 5000, weight: step.weight }));
    expect(timeLeftSeconds(rows), id).toBeNull();
  }
});
