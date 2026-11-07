import { expect, test } from 'vitest';
import { DayCycle } from './dayCycle';

const clock = () => new DayCycle({ units: 'hour', start: 19, schedule: [{ phase: 'day', from: 0, to: 24, minutes: 24 }],
  sun: { maxElevation: 60, azimuthOffset: 250 }, fixed: { midday: 12, golden: 18, sunset: 19, night: 0 }, presets: { dawn: 6, noon: 12, dusk: 19, night: 0 } });

test('a hold stills the clock where it is and reads as pinned until every hold is released (G639 Explorer)', () => {
  const day = clock();
  expect(day.pinned).toBe(false);
  const a = day.hold(), b = day.hold();
  day.update(60);
  expect(day.hour).toBe(19); expect(day.pinned).toBe(true);
  a(); a(); // a release is once
  day.update(60);
  expect(day.hour).toBe(19); expect(day.pinned).toBe(true);
  b();
  expect(day.pinned).toBe(false);
  day.update(60);
  expect(day.hour).toBeCloseTo(20, 9); // a 24-minute day: an hour a minute
});

test('a light preset pin reads as pinned and its release keeps an Explorer hold', () => {
  const day = clock(), release = day.hold();
  day.pin('noon');
  expect(day.hour).toBe(12); expect(day.pinned).toBe(true);
  day.pin(null);
  expect(day.hour).toBe(19); expect(day.pinned).toBe(true);
  release();
  expect(day.pinned).toBe(false);
});
