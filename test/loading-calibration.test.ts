import {expect, it} from 'vitest';
import {loadingFraction} from '../src/client/engine/boot/weights';
import {loadingPath} from '../src/client/game/boot/loadingPaths';

it('every shipping path remains unchanged by elapsed time or former calibration history', () => {
  for (const kind of ['grid', 'shardfile', 'legacy', 'cell', 'crossing'] as const) {
    const rows = loadingPath(kind).steps.map(() => ({state: 'todo' as const, ms: 0}));
    expect(loadingFraction(rows)).toBe(0);
    expect(loadingFraction(rows.map(row => ({...row, ms: 1_000_000})))).toBe(0);
    expect(loadingFraction(rows.map(row => ({...row, state: 'ok' as const})))).toBeLessThan(1);
    expect(loadingFraction(rows, true)).toBe(1);
  }
});
