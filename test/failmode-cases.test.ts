import { expect, test } from 'vitest';
import { CASES, rawLeak, selectCases, verdict } from '../src/scripts/failmode-cases.mjs';

// FM3: the failure proof's case manifest and verdict (src/scripts/failmode-proof.mjs runs the cases in a browser).
test('every catalogue mode 1 to 46 has one case, and every b case sits under a real parent', () => {
  const numeric = CASES.filter(item => item.parent === undefined).map(item => Number(item.mode));
  expect(numeric).toEqual(Array.from({ length: 46 }, (_unused, index) => index + 1));
  const ids = new Set(CASES.map(item => item.id));
  expect(ids.size).toBe(CASES.length);
  for (const item of CASES.filter(row => row.parent !== undefined)) expect(ids.has(item.parent ?? ''), item.id).toBe(true);
  expect(CASES.filter(row => row.parent !== undefined)).toHaveLength(9);
  for (const item of CASES) expect(item.run !== undefined || item.blocked !== undefined, `${item.id} has a runner or a named reason`).toBe(true);
});

test('a scenario list brings its hold cards, and an unknown id refuses', () => {
  expect(selectCases('drop').map(item => item.id)).toEqual(['drop', 'drop/blocked']);
  expect(selectCases('all')).toHaveLength(CASES.length);
  expect(() => selectCases('drop,nope')).toThrow(/nope/u);
  expect(() => selectCases('')).toThrow();
});

test('only all-pass is green; a harness failure outranks every screen', () => {
  expect(verdict([{ outcome: 'pass' }, { outcome: 'pass' }])).toBe(0);
  expect(verdict([])).toBe(1);
  expect(verdict([{ outcome: 'pass' }, { outcome: 'blocked-dependency' }])).toBe(1);
  expect(verdict([{ outcome: 'unsupported' }])).toBe(1);
  expect(verdict([{ outcome: 'ui-fail' }, { outcome: 'harness-fail' }])).toBe(2);
});

test('primary copy may not carry a raw error, an address or a status', () => {
  expect(rawLeak('Reconnecting · one moment')).toBeNull();
  expect(rawLeak('Slow connection · 480 ms')).toBeNull();
  expect(rawLeak('No release file at http://127.0.0.1/x: 503')).toBe('http://');
  expect(rawLeak('TypeError: Failed to fetch')).toBe('TypeError');
  expect(rawLeak('Server error 503')).toBe('503');
});
