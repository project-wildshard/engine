import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { REAL_GC_CHILD_MS } from '../src/test/engine/realGc.ts';

// The real-GC child must finish (or time out on its own) before the parent test's timeout, with room for the
// parent's own work; a hosted runner under load took the old 20 s budget past its limit (engine run 45452091364).
test('the real-GC child budget fits inside the parent test timeout', () => {
  const config = readFileSync('vitest.config.ts', 'utf8');
  const parent = Number(/testTimeout:\s*([\d_]+)/u.exec(config)?.[1]?.replaceAll('_', ''));
  expect(parent).toBeGreaterThan(0);
  expect(REAL_GC_CHILD_MS).toBeGreaterThan(20_000);
  expect(parent - REAL_GC_CHILD_MS).toBeGreaterThanOrEqual(3_000);
});
