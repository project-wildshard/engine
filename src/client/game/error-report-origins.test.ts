import { expect, test } from 'vitest';
import { WILDSHARD_IDENTITY } from './identity';

// SENTRY-TRIAGE S1: the live hosts report to Sentry, each under its own environment; nothing else does. The engine's
// browserErrorDeliveryAllowed (exact origin match) and browserErrorEnvironment (map, else production) read these lists;
// browser-errors-policy.test.ts proves those two functions.
const origins = WILDSHARD_IDENTITY.errorReportOrigins ?? [];
const environments = WILDSHARD_IDENTITY.errorReportEnvironments ?? {};

test.each([
  ['https://play.wildshard.io', 'production'],
  ['https://staging.wildshard.io', 'staging'],
  ['https://preview.wildshard.io', 'preview'],
] as const)('%s reports as %s', (origin, environment) => {
  expect(origins).toContain(origin);
  expect(environments[origin]).toBe(environment);
});

// OFF-VERCEL OV9: the page is served only from the three game hosts, so only they report.
test('every mapped environment belongs to a reporting origin, and only the three game hosts report', () => {
  expect([...origins].sort()).toEqual(['https://play.wildshard.io', 'https://preview.wildshard.io', 'https://staging.wildshard.io']);
  for (const origin of Object.keys(environments)) expect(origins).toContain(origin);
});

test.each([
  'https://wildshard.io', 'http://play.wildshard.io', 'https://play.wildshard.io.evil.invalid', 'https://dev.wildshard.io',
  'https://wildshard-play.workers.dev', 'http://localhost:4401',
])('an unknown origin %s is not on the list', (origin) => {
  expect(origins).not.toContain(origin);
});
