import { expect, it } from 'vitest';
import { staleReason } from '../scripts/whats-new-fresh.mjs';
import { WHATS_NEW } from '../src/client/game/whatsNew';

const now = Date.parse('2026-10-17T18:00:00Z');
const body = (updated?: unknown): string => JSON.stringify({ date: '17 OCT 2026', entries: ['a line'], ...(updated === undefined ? {} : { updated }) });

it('passes lines updated within 24 h, any zone', () => {
  expect(staleReason(body('2026-10-17T13:00:00-05:00'), now)).toBeNull();
  expect(staleReason(body('2026-10-16T18:30Z'), now)).toBeNull();
  expect(staleReason(body('2026-10-17T18:45:00Z'), now)).toBeNull(); // a little clock skew is fine
});

it('fails stale, future, missing and unparseable stamps, saying how to fix it', () => {
  expect(staleReason(body('2026-10-16T17:59:00Z'), now)).toMatch(/24\.0 h old.*Fix: rewrite src\/(?:client|cook|server|shared)\/game\/whatsNew\.json/u);
  expect(staleReason(body('2026-10-17T19:30:00Z'), now)).toMatch(/future/u);
  expect(staleReason(body(), now)).toMatch(/no "updated"/u);
  expect(staleReason(body('17 OCT 2026'), now)).toMatch(/not an ISO timestamp/u);
  expect(staleReason(body('2026-10-17T13:00:00'), now)).toMatch(/not an ISO timestamp/u); // no zone
  expect(staleReason(body(1760724000000), now)).toMatch(/no "updated"/u);
  expect(staleReason('{', now)).toMatch(/not valid JSON/u);
});

it('the committed file carries a parseable stamp and 3–5 lines', () => {
  expect(Number.isFinite(Date.parse(WHATS_NEW.updated))).toBe(true);
  expect(WHATS_NEW.entries.length).toBeGreaterThanOrEqual(3);
  expect(WHATS_NEW.entries.length).toBeLessThanOrEqual(5);
});
