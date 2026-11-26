import type { CookIndex } from '../cook/game/cookWorker.ts';

/** Compare the admitted index while keeping the original runtime timings for the proof receipt. */
export function deterministicCookIndex(index: CookIndex): CookIndex {
  const { check } = index;
  if (check === undefined) return { ...index, seconds: 0 };
  const { performance } = check;
  const { scripts } = performance;
  const measured = { ...scripts.scripts, maxMicros: 0, p95Micros: 0 };
  return {
    ...index, seconds: 0,
    check: { ...check, performance: { ...performance, scripts: { ...scripts, scripts: measured } } },
  };
}
