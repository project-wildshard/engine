import { expect, test } from 'vitest';
import { gridBootWaitHistory } from '../scripts/parity/grid-boot-waits.mjs';

test('the original healthy-home pending-far failure stays unassigned without phase evidence', () => {
  const history = gridBootWaitHistory();
  history.observe('grid gameplay', 147_322, { ready: true, frame: 1233, drawnFrame: 1233, visibility: 'visible', clockPaused: false,
    grid: { ringsReady: false, rings: { inFlight: 7, queued: 0, refused: 0 },
      ringsWait: { cells: ['nine-dragon-stack', 'pine-hollow', 'open-plot-nw', 'template-2', 'open-plot-2-0', 'open-plot-1-0', 'open-plot-3-0']
        .map(instance => ({ instance, far: 'fetching' })) } } });
  expect(history.samples).toHaveLength(1);
  expect(history.samples[0]).toMatchObject({ frame: 1233, drawnFrame: 1233, ready: true, ringsReady: false, inFlight: 7, queued: 0, refused: 0,
    preparation: [], waits: { count: null, oldest: [] } });
  expect(history.samples[0]?.cells).toHaveLength(7);
});

test('phase transitions and IO ages survive the same polls without retaining resources or mutable rows', () => {
  const history = gridBootWaitHistory(), row = { instance: 'cell', phase: 'load', ageMs: 4000, phaseAgeMs: 4000 };
  const observation = { ready: true, grid: { ringsReady: false, rings: { inFlight: 1, queued: 0, refused: 0 },
    ringsWait: { cells: [{ instance: 'cell', far: 'fetching' }], preparation: [row], waits: { count: 1,
      oldest: [{ label: 'read:original', kind: 'worker', ageMs: 3000 }] } }, resource: { forbidden: 'resource-bytes' } } };
  history.observe('grid gameplay', 5000, observation);
  history.observe('grid gameplay', 5100, observation);
  expect(history.samples).toHaveLength(1);
  row.phase = 'prepare'; row.ageMs = 4200; row.phaseAgeMs = 0;
  observation.grid.ringsWait.waits = { count: 0, oldest: [] };
  history.observe('grid gameplay', 5200, observation);
  expect(history.samples).toHaveLength(2);
  expect(history.samples[0]?.preparation).toEqual([{ instance: 'cell', phase: 'load', ageMs: 4000, phaseAgeMs: 4000 }]);
  expect(history.samples[1]?.preparation).toEqual([{ instance: 'cell', phase: 'prepare', ageMs: 4200, phaseAgeMs: 0 }]);
  expect(history.samples[0]?.waits.oldest).toEqual([{ label: 'read:original', kind: 'worker', ageMs: 3000 }]);
  expect(JSON.stringify(history.samples)).not.toContain('resource-bytes');
});

test('steady stalls retain their last minute and every collection has a fixed bound', () => {
  const history = gridBootWaitHistory();
  history.observe('title', 0, { grid: null }); expect(history.samples).toEqual([]);
  const unbounded = Array.from({ length: 100 }, (_, index) => ({ instance: `cell${index}`, far: 'fetching' }));
  for (let frame = 0; frame < 100; frame++) history.observe('grid gameplay', frame * 1000,
    { frame, grid: { ringsWait: { cells: unbounded, preparation: unbounded, waits: { oldest: unbounded } } } });
  expect(history.samples).toHaveLength(64);
  expect(history.samples[0]?.frame).toBe(36);
  expect(history.samples[63]?.frame).toBe(99);
  expect(history.samples[0]?.cells).toHaveLength(32);
  expect(history.samples[0]?.preparation).toHaveLength(32);
  expect(history.samples[0]?.waits.oldest).toHaveLength(16);
});
