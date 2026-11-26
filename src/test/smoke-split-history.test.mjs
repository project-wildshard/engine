import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readSmokeHistory, smokeSplitRegression } from '../scripts/smoke-split-history.mjs';

const now = '2026-11-15T20:00:00.000Z';
const receipt = (at, split, profile = 'darwin-arm64-metal-cold') => ({ at, profile, split });
const history = [1, 2, 3].map(day => receipt(`2026-11-${String(10 + day)}T20:00:00.000Z`, { fetch: 1000, packDecode: 1000, wasm: 1000 }));

test('a planted three-second pack decode growth flags only that leaf', () => {
  const verdict = smokeSplitRegression(receipt(now, { fetch: 1000, packDecode: 4000, wasm: 1000 }), history);
  assert.deepEqual(verdict.filter(row => row.flagged).map(row => row.name), ['packDecode']);
  assert.equal(verdict.find(row => row.name === 'packDecode').medianMs, 1000);
});

test('uses the weekly median, excludes the current/future run and other profiles', () => {
  const current = receipt(now, { fetch: 1300 });
  const mixed = [...history, receipt('2026-11-01T20:00:00.000Z', { fetch: 1 }), current,
    receipt('2026-11-16T20:00:00.000Z', { fetch: 1 }), receipt('2026-11-14T20:00:00.000Z', { fetch: 1 }, 'linux-x64-swiftshader-warm'),
    receipt('2026-11-14T20:00:00.000Z', { fetch: 8000 })];
  assert.deepEqual(smokeSplitRegression(current, mixed), [{ name: 'fetch', ms: 1300, medianMs: 1000, samples: 4, flagged: true }]);
});

test('an absent leaf or fewer than three observations cannot establish a baseline', () => {
  const verdict = smokeSplitRegression(receipt(now, { fetch: 5000, packDecode: 1000 }), [history[0], receipt('2026-11-14T20:00:00.000Z', { wasm: 1 })]);
  assert.equal(verdict[0].samples, 1);
  assert.equal(verdict[0].flagged, false);
  assert.equal(verdict[1].samples, 1);
  assert.equal(verdict[1].flagged, false);
});

test('mixed receipt logs ignore malformed, negative and non-finite entries', () => {
  const good = receipt(now, { fetch: 1000 });
  const lines = ['a regular lane receipt', `16:00 Cancún codex-te2e TEMPLATE_SMOKE ${JSON.stringify(good)}`,
    'TEMPLATE_SMOKE {', `TEMPLATE_SMOKE ${JSON.stringify(receipt(now, { fetch: -1 }))}`,
    `TEMPLATE_SMOKE ${JSON.stringify(receipt('not-a-date', { fetch: 1 }))}`];
  assert.deepEqual(readSmokeHistory(lines.join('\n')), [good]);
  assert.throws(() => smokeSplitRegression(receipt(now, { fetch: NaN }), history), /Invalid smoke receipt/u);
});
