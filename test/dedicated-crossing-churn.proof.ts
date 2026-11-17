import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The proof's report, where CHURN_REPORT says.
import { writeFileSync } from 'node:fs';
import { crossingChurn } from './fixtures/dedicated/crossingChurn';

// MMO-PLAN MP1.6's done-when, run by name (it is not in the suite): `CROSSINGS=10000 CHURN_BOTS=8 pnpm vitest run
// test/dedicated-crossing-churn.proof.ts`. Bots cross Driftwood ↔ Sunscar (one worker) and Driftwood ↔ Nalati (two workers) on their
// one socket, paying a coin into each shard's bag on every visit, and the report says what moved and what, if anything, was lost.
const crossings = Number(process.env['CROSSINGS'] ?? 10_000), bots = Number(process.env['CHURN_BOTS'] ?? 8);
test(`${String(crossings)} crossings under ${String(bots)} bots lose or double no seat, coin or link`, { timeout: 6 * 3600_000 }, async () => {
  const report = await crossingChurn({ crossings, bots, log: line => { console.log(`[churn] ${line}`); } });
  const out = process.env['CHURN_REPORT'];
  if (out !== undefined) writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
  expect(report.crossings).toBeGreaterThanOrEqual(crossings);
  expect(report.inside).toBeGreaterThan(0); expect(report.between).toBeGreaterThan(0);
  expect({ lost: report.lost, doubled: report.doubled, bags: report.bagMismatches, closes: report.socketCloses, crashes: report.crashes, refusals: report.crossRefusals, unmoved: report.unmovedLines })
    .toEqual({ lost: 0, doubled: 0, bags: [], closes: 0, crashes: 0, refusals: 0, unmoved: 0 });
  expect([report.seatsMin, report.seatsMax]).toEqual([report.bots, report.bots]);
  expect(report.movedLines).toBe(report.crossings);
});
