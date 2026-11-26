import { expect, test } from 'vitest';
import { fpsVerdict } from '../scripts/fps/verdict.mjs';

const route = [{ name: 'dock', seconds: 60 }, { name: 'road', seconds: 60 }];
const sample = (ms, frames = 1800, seconds = 60) => ({ seconds, frames, frameMs: Array(frames).fill(ms) });
const run = (dock, road = sample(33.3)) => [{ name: 'dock', samples: [dock] }, { name: 'road', samples: [road] }];

test('grades the whole run and every segment against the five floor measures', () => {
  expect(fpsVerdict(run(sample(33.3)), route, 30).verdict).toBe('pass');
  const slow = sample(33.3, 1745);
  const p50 = sample(34);
  const p95 = sample(33.3); p95.frameMs.fill(41, 1700);
  const max = sample(33.3); max.frameMs[0] = 101;
  for (const [key, row] of [['fps', slow], ['p50', p50], ['p95', p95], ['max', max]]) {
    const report = fpsVerdict(run(row), route, 30);
    expect(report.verdict).toBe('miss');
    expect(report.segments[0].result.misses).toContain(key);
  }
});

test('one extra spike misses even if the whole route averages one per minute', () => {
  const dock = sample(33.3);
  dock.frameMs[0] = 51;
  expect(fpsVerdict(run(dock), route, 30).verdict).toBe('pass');
  dock.frameMs[1] = 51;
  const report = fpsVerdict(run(dock), route, 30);
  expect(report.overall.misses).toEqual([]);
  expect(report.segments[0].result.misses).toEqual(['spikesPerMinute']);
  expect(report.verdict).toBe('miss');
});

test('60 and 120 use their own intervals and 120 allows zero spikes', () => {
  const sixty = sample(16.67, 3600), fast = sample(8.33, 7200);
  expect(fpsVerdict(run(sixty, sixty), route, 60).verdict).toBe('pass');
  expect(fpsVerdict(run(fast, fast), route, 120).verdict).toBe('pass');
  fast.frameMs[0] = 50.01;
  expect(fpsVerdict(run(fast, fast), route, 120).overall.misses).toEqual(['max', 'spikesPerMinute']);
});

test('a short, missing, interrupted or overrun ring is incomplete', () => {
  const dock = sample(33.3), road = sample(33.3);
  expect(fpsVerdict(run(dock).slice(0, 1), route, 30).verdict).toBe('incomplete');
  expect(fpsVerdict(run(dock, sample(33.3, 1770, 59)), route, 30).verdict).toBe('incomplete');
  const legs = run(dock, road);
  legs[1].error = 'stuck';
  expect(fpsVerdict(legs, route, 30).verdict).toBe('incomplete');
  delete legs[1].error;
  road.frameMs.pop();
  expect(fpsVerdict(legs, route, 30).verdict).toBe('incomplete');
});


test('interval accumulation preserves the duration boundary and rejects a real shortfall', () => {
  const samples = [...Array.from({length:266}, () => sample(16, 1, 0.15)), sample(16, 1, 0.1)];
  const leg = {name:'road', samples}, expected = [{name:'road', seconds:40}];
  expect(samples.reduce((total, row) => total + row.seconds, 0)).toBeLessThan(40);
  expect(fpsVerdict([leg], expected, 30).verdict).toBe('miss');
  samples.at(-1).seconds -= 1e-8;
  expect(fpsVerdict([leg], expected, 30).verdict).toBe('incomplete');
});
