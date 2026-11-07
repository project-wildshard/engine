// DL20: the telemetry record's download.parts counts. An .mjs test: the api project (ES2023, its own tsconfig) stays out of
// the test project's type check, as the other api readers do.
import { expect, test } from 'vitest';
import { cleanTelemetryRecord } from '../api/_telemetryRecord.ts';

/** One analytics record carrying a single download.parts event with `data`. @param {Record<string, unknown>} data */
function parts(data) {
  const record = cleanTelemetryRecord({ kind: 'analytics', build: 'b', install: 'i', events: [{ name: 'download.parts', data: { level: 'nine', ...data } }] });
  if (record === null || record.kind !== 'analytics') throw new Error('download.parts record refused');
  return record.events[0]?.data;
}

// sp-x1's offline control: a missing or malformed count is an 'unknown' boot, never a silent 0
test('a download.parts count that is missing or not a nonnegative integer makes the boot unknown, never 0', () => {
  expect(parts({ parts: 7, failed: 1 })).toEqual({ shard: 'nine', counts: 'unknown' });
  expect(parts({ parts: 7, failed: 0, fallback: 'unknown' })).toEqual({ shard: 'nine', counts: 'unknown' });
  expect(parts({})).toEqual({ shard: 'nine', counts: 'unknown' });
  expect(parts({ parts: 7, failed: -1, fallback: 0 })).toEqual({ shard: 'nine', counts: 'unknown' });
  expect(parts({ parts: 7.5, failed: 0, fallback: 0 })).toEqual({ shard: 'nine', counts: 'unknown' });
});

test('well-formed counts, the outcome and the loose fetches made are kept', () => {
  expect(parts({ parts: 7, failed: 1, fallback: 3, fetched: 3, outcome: 'failed', packs: 'on' }))
    .toEqual({ shard: 'nine', parts: 7, failed: 1, fallback: 3, fetched: 3, outcome: 'failed', packs: 'on' });
  expect(parts({ parts: 0, failed: 0, fallback: 0, packs: 'off' })).toEqual({ shard: 'nine', parts: 0, failed: 0, fallback: 0, packs: 'off' });
  expect(parts({ parts: 0, failed: 0, fallback: 0, packs: true })).toEqual({ shard: 'nine', parts: 0, failed: 0, fallback: 0 });
  // the outcome's id (at-least-once delivery: a reader counts each id once); a malformed one is dropped
  expect(parts({ parts: 0, failed: 0, fallback: 0, id: '0f3c9a2e-1b2c-4d5e-8f90-123456789abc' }))
    .toEqual({ shard: 'nine', parts: 0, failed: 0, fallback: 0, id: '0f3c9a2e-1b2c-4d5e-8f90-123456789abc' });
  expect(parts({ parts: 0, failed: 0, fallback: 0, id: 'x y' })).toEqual({ shard: 'nine', parts: 0, failed: 0, fallback: 0 });
  expect(parts({ parts: 7, failed: 0, fallback: 0 })).toEqual({ shard: 'nine', parts: 7, failed: 0, fallback: 0 });
  expect(parts({ parts: 7, failed: 0, fallback: 0, fetched: 'x', outcome: 'other' })).toEqual({ shard: 'nine', parts: 7, failed: 0, fallback: 0 });
});

// sp-x6's review of be2df44ec8: the digest counts each delivered outcome once and buckets boots without their ids
test('the daily digest counts a replayed outcome once and groups boots without their ids', async () => {
  const { dailyDigest } = await import('../api/telemetry.ts');
  const record = (id) => cleanTelemetryRecord({ kind: 'analytics', build: 'b', install: 'i',
    events: [{ name: 'download.parts', data: { level: 'nine', parts: 7, failed: 0, fallback: 0, outcome: 'complete', packs: 'on', id } }] });
  const replay = 'aaaaaaaa-0000-4000-8000-000000000001', other = 'bbbbbbbb-0000-4000-8000-000000000002';
  const digest = dailyDigest([record(replay), record(replay), record(other)]);
  expect(digest.counts['download.parts']).toEqual({ 'nine / 7 / 0 / 0 / complete / on': 2 });
});
