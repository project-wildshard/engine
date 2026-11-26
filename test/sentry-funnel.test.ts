import { expect, test } from 'vitest';
import { funnelViolations, sourceFiles } from '../src/scripts/sentry-funnel.mjs';
import { overLine, table } from '../src/scripts/sentry-weekly.mjs';

// SENTRY-ZERO SZ7 (Jake, 2026-11-23: "Everything in sentry MUST be a bug, and it must be fixed and it must be low frequency").

test('the tree sends to Sentry only through the two funnels, and never at warning or info level', () => {
  expect(funnelViolations(sourceFiles())).toEqual([]);
});

test('a planted capture outside the funnels, or a warning level, is refused', () => {
  const planted = [
    { path: 'src/client/game/x.ts', text: "import * as Sentry from '@sentry/browser';\nSentry.captureException(new Error('x'));" },
    { path: 'src/client/engine/telemetry/browserErrors.ts', text: "import type { init } from '@sentry/browser';\nscope.setLevel('warning');" },
    { path: 'src/server/host/dedicated/other.ts', text: "import { captureMessage } from '@sentry/core';\ncaptureMessage('hi', { level: 'info' });" },
  ];
  const found = funnelViolations(planted);
  expect(found.some((line) => line.startsWith('src/client/game/x.ts:2: a Sentry capture outside'))).toBe(true);
  expect(found.some((line) => line.startsWith('src/client/engine/telemetry/browserErrors.ts:2: a warning or info level'))).toBe(true);
  expect(found.filter((line) => line.startsWith('src/server/host/dedicated/other.ts:2'))).toHaveLength(2);
});

test('code that never imports Sentry may name its own captureException or level', () => {
  expect(funnelViolations([{ path: 'src/client/game/y.ts', text: "const level: 'warning' = 'warning';\nfoo.captureException(e);" }])).toEqual([]);
  expect(funnelViolations([{ path: 'src/client/game/z.test.ts', text: "import '@sentry/browser';\nSentry.captureException(e);" }])).toEqual([]);
});

test('the weekly check lists the issues over the line, worst first, from the API or the MCP shape', () => {
  const issues = [
    { shortId: 'G-1', title: 'quiet', count: '20' },
    { shortId: 'G-2', title: 'loud', count: '3067' },
    { shortId: 'G-3', title: 'from the MCP', occurrences: 180 },
  ];
  const rows = overLine(issues, { days: 7, perDay: 5 });
  expect(rows.map((row) => row.id)).toEqual(['G-2', 'G-3']);
  expect(table(rows, { days: 7, perDay: 5 })).toContain('| G-2 | 3067 | 438.1 | loud |');
  expect(table([], { days: 7, perDay: 5 })).toContain('no unresolved issue over 5 events a day');
});
