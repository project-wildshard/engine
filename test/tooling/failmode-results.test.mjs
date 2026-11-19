import { expect, test } from 'vitest';
import { CASES } from '../../scripts/failmode-cases.mjs';
import { BOOT_SCREEN_MS, bootScreenWait, qualifyResult } from '../../scripts/failmode-results.mjs';
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
// QA-FEEDBACK 2026-11-19 row 8: a page reads its release file again only when it dials, after the world has loaded. Hosted
// SwiftShader takes over 30 s to get there, so a 30 s window called a slow boot a missing screen.
const clocked = (/** @type {{ screenAt?: number, worldAt?: number }} */ at) => {
  let ms = 0;
  return { now: () => ms, screen: async () => { ms += 500; return at.screenAt !== undefined && ms >= at.screenAt ? { ids: 'release-429' } : null; },
    inWorld: async () => at.worldAt !== undefined && ms >= at.worldAt };
};
test('a boot screen that comes after a slow load is still seen', async () => {
  expect(BOOT_SCREEN_MS).toBeGreaterThanOrEqual(150_000);
  expect(await bootScreenWait(clocked({ screenAt: 41_000 }), BOOT_SCREEN_MS)).toEqual({ seen: { ids: 'release-429' } });
});
test('a page in the world with no boot screen fails at once, not at the deadline', async () => {
  const probe = clocked({ worldAt: 20_000 });
  expect(await bootScreenWait(probe, BOOT_SCREEN_MS)).toEqual({ seen: null, why: 'in the world' });
  expect(probe.now()).toBeLessThan(25_000);
});
test('a page that neither dials nor shows the screen stops at the deadline', async () => {
  const probe = clocked({});
  expect(await bootScreenWait(probe, 60_000)).toEqual({ seen: null, why: 'deadline' });
  expect(probe.now()).toBeGreaterThanOrEqual(60_000);
});
