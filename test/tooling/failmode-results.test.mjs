import { expect, test } from 'vitest';
import { CASES } from '../../scripts/failmode-cases.mjs';
import { qualifyResult } from '../../scripts/failmode-results.mjs';
const item = CASES.find(row => row.id === 'drop');
const pass = { outcome: 'pass', seen: { ids: 'drop reset', ms: 20, copy: 'Reconnecting', leak: null }, injection: { socketMatches: 1 }, shot: 'drop-down.png', recovery: 'a real frame, no card' };
test('all modes and siblings carry bounded case deadlines without shortening actual clocks', () => {
  for (const row of CASES) expect(row.deadlineMs).toBeGreaterThanOrEqual(300_000);
  expect(CASES.find(row => row.id === 'lost').deadlineMs).toBe(360_000);
});
test('complete independent evidence qualifies; repaint names may carry siblings', () => {
  expect(qualifyResult(item, pass, 100)).toEqual(pass);
});
test('every missing proof component independently refuses even an optimistic pass', () => {
  for (const broken of [
    { ...pass, seen: null }, { ...pass, seen: { ...pass.seen, ids: 'other' } },
    { ...pass, seen: { ...pass.seen, copy: '' } }, { ...pass, seen: { ...pass.seen, ms: -1 } },
    { ...pass, seen: { ...pass.seen, leak: '503' } }, { ...pass, injection: undefined },
    { ...pass, injection: {} }, { ...pass, shot: undefined }, { ...pass, recovery: '' },
  ]) expect(qualifyResult(item, broken, 100).outcome).toBe('harness-fail');
  expect(qualifyResult(item, pass, item.deadlineMs + 1).outcome).toBe('harness-fail');
});
test('baseline keeps honest UI and dependency gaps without qualifying or hiding them', () => {
  for (const outcome of ['ui-fail', 'unsupported', 'blocked-dependency', 'harness-fail']) {
    const result = { outcome, reason: 'owned row or missing native control' };
    expect(qualifyResult(item, result, 10)).toEqual(result);
  }
});
