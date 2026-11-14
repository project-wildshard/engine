import { expect, test } from 'vitest';
import { pairKey, tighten, worse } from '../scripts/grid-crossing-ratchet.mjs';

// GRID-CROSSING GC3: a crossing run that worsens any pair past its ratchet fails; the ratchet only tightens.
const KEY = pairKey('preview', 'chromium-desktop', 'driftwood-isle', 'sunscar-dunes');
const held = { [KEY]: { ok: true, borderToControlMs: 1000, freezeMs: 200, wallMs: 0, over50: 2 } };

test('a pair that passed and now fails is worse', () => {
  expect(worse(held, { [KEY]: { ok: false } })).toEqual([{ key: KEY, measure: 'ok', held: true, now: false }]);
});

test('a measure past its allowance is worse; noise inside it is not', () => {
  expect(worse(held, { [KEY]: { ok: true, borderToControlMs: 2400, freezeMs: 650, wallMs: 400, over50: 5 } })).toEqual([]);
  expect(worse(held, { [KEY]: { ok: true, borderToControlMs: 2600, freezeMs: 200, wallMs: 600, over50: 6 } }).map(row => row.measure)).toEqual(['borderToControlMs', 'wallMs', 'over50']);
});

test('a pair the ratchet does not hold, or a run that skipped one, is not worse', () => {
  expect(worse(held, { [pairKey('preview', 'webkit-phone', 'a', 'b')]: { ok: false } })).toEqual([]);
  expect(worse(held, {})).toEqual([]);
});

test('tightening only lowers a number, holds a newly passing pair to passing and adds new pairs', () => {
  const failing = { ...held, x: { ok: false } };
  const next = tighten(failing, { [KEY]: { ok: true, borderToControlMs: 1500, freezeMs: 100, wallMs: 0, over50: 1 }, x: { ok: true, borderToControlMs: 9000 }, y: { ok: false } });
  expect(next[KEY]).toEqual({ ok: true, borderToControlMs: 1000, freezeMs: 100, wallMs: 0, over50: 1 });
  expect(next['x']).toEqual({ ok: true, borderToControlMs: 9000 });
  expect(next['y']).toEqual({ ok: false });
  expect(tighten(next, { [KEY]: { ok: false } })[KEY]?.ok).toBe(true);
});
