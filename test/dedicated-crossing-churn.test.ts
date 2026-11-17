import { expect, test } from 'vitest';
import { crossingChurn } from './fixtures/dedicated/crossingChurn';

// MMO-PLAN MP1.6, the hosted-CI size: two bots make 16 crossings between them, inside a worker (Driftwood ↔ Sunscar) and between
// workers (Driftwood ↔ Nalati), beside a bystander in each worker's cell. `dedicated-crossing-churn.proof.ts` runs the 10,000.
test('crossings inside and between workers lose or double no seat, coin or link', { timeout: 300_000 }, async () => {
  const report = await crossingChurn({ crossings: 16, bots: 2 });
  expect(report.crossings).toBeGreaterThanOrEqual(16);
  expect(report.inside, 'some moves stay on one worker').toBeGreaterThan(0);
  expect(report.between, 'some moves change worker').toBeGreaterThan(0);
  expect({ lost: report.lost, doubled: report.doubled, bags: report.bagMismatches, closes: report.socketCloses, crashes: report.crashes, refusals: report.crossRefusals, unmoved: report.unmovedLines })
    .toEqual({ lost: 0, doubled: 0, bags: [], closes: 0, crashes: 0, refusals: 0, unmoved: 0 });
  expect([report.seatsMin, report.seatsMax], 'the door counts every bot, every sample').toEqual([report.bots, report.bots]);
  // Every gate entry and every road exit is one `cell.crossed` the door logged as moved.
  expect(report.movedLines).toBe(report.crossings);
});

// MP1.6's 10,000 stopped at ~7,600 crossings: every walker stood still in Nalati. A client's command `seq` is a u16 that runs on across a
// crossing, but a cell on another worker hears it with a fresh queue whose `lastSeq` is 0; past 0x8000 (about nine minutes at 60 Hz)
// that 0 reads as ahead of every command the client holds, so it took all of them as acknowledged and sent nothing more.
test('a client past half its seq range still moves after a crossing to another worker', { timeout: 300_000 }, async () => {
  const report = await crossingChurn({ crossings: 8, bots: 1, startSeq: 40_000 });
  expect(report.between, 'it changed worker').toBeGreaterThan(0);
  expect({ lost: report.lost, doubled: report.doubled, closes: report.socketCloses, unmoved: report.unmovedLines }).toEqual({ lost: 0, doubled: 0, closes: 0, unmoved: 0 });
  // MP1.6b, the root: the hand-out carries the source queue's `lastSeq`, so the arriving owner block never says 0
  expect(report.zeroAcks, 'owner blocks that forgot the stepped seq').toBe(0);
});
