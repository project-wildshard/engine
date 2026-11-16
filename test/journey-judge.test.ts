// STAGING-BUGBASH SB5: the journey judge (scripts/journey-proof.mjs) fails a blank over half a second; the grid's sky-down
// arrival under its ARRIVING caption is a screen of its own, not a blank.
import { expect, test } from 'vitest';
import { judge, label } from '../scripts/journey-proof.mjs';

const screen = (over: Record<string, boolean>) => ({ doc: 1, path: '/w', shell: false, title: false, select: false, loading: false, bar: false, hud: false, modal: false, ...over });

test('the arrival flight is not blank; 600 ms of nothing is blank', () => {
  expect(label(screen({ reveal: true }))).toBe('arrival');
  const run = (middle: Record<string, boolean>) => [0, 120, 240, 360, 480, 600, 720, 840].map((t, i) => ({ t, s: screen(i === 0 ? { loading: true } : i === 7 ? { hud: true } : middle) }));
  expect(judge(run({ reveal: true }))).toEqual([]);
  expect(judge(run({})).map((p) => p.text)).toEqual(['a blank screen for over 500 ms']);
});
