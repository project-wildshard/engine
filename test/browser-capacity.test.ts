// DS20c (meta FLOW-SIMPLE FS17, J443): browser slots are free cores / 4, recomputed per read, in place of J402's two.
// oxlint-disable-next-line import/no-nodejs-modules -- Replace the process table with a fixed browser listing.
import { execFileSync } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { browserSlots, browserStatus, reservedSlots } from '../src/scripts/browser-usage.mjs';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFileSync: vi.fn(),
}));

const lease = (token: string, slots: number, extra: Record<string, unknown> = {}) => ({ token, slots, ...extra });

test('eight free cores offer two slots, three offer none, and open browsers keep theirs', () => {
  expect(browserSlots({ capacity: 8, active: [], outside: 0 })).toBe(2);
  expect(browserSlots({ capacity: 16, active: [lease('a', 5), lease('b', 3)], outside: 0 })).toBe(2);
  expect(browserSlots({ capacity: 3, active: [], outside: 0 })).toBe(0);
  expect(browserSlots({ capacity: 12, active: [lease('a', 4, { browser: true, browserWeight: 4 }), lease('b', 5)], outside: 0 })).toBe(1);
  // A browser outside the ledger is charged four cores and counts as open.
  expect(browserSlots({ capacity: 12, active: [], outside: 1 })).toBe(3);
  expect(browserSlots({ capacity: 4, active: [], outside: 2 })).toBe(2);
});

test('reserved cores follow the ledger: a borrowed grant is covered by its root, browsers weigh in when heavier', () => {
  expect(reservedSlots([lease('root', 6), lease('kid', 2, { borrowedFrom: 'root' })])).toBe(6);
  expect(reservedSlots([lease('root', 2), lease('b1', 4, { borrowedFrom: 'root', browser: true, browserWeight: 4 })])).toBe(4);
  expect(reservedSlots([lease('a', 4, { browser: true, browserWeight: 4 }), lease('orphan', 3, { borrowedFrom: 'gone' })])).toBe(7);
});

test('counts Chrome for Testing without charging its Crashpad helper as another browser', () => {
  const chrome = '/Users/example/.agent-browser/browsers/chrome-157/Google Chrome for Testing.app/Contents';
  vi.mocked(execFileSync).mockReturnValueOnce([
    `5100001 1 ${chrome}/MacOS/Google Chrome for Testing --headless --mute-audio`,
    `5100002 1 ${chrome}/Frameworks/Google Chrome for Testing Framework.framework/Versions/157/Helpers/chrome_crashpad_handler --monitor-self`,
    '5100003 1 /Users/example/Library/Caches/ms-playwright/chromium-157/chrome-headless-shell --mute-audio',
    '5100004 5100003 /Users/example/Library/Caches/ms-playwright/chromium-157/chrome-headless-shell --type=renderer',
  ].join('\n'));
  expect(browserStatus().outside).toEqual([5100001, 5100003]);
});
