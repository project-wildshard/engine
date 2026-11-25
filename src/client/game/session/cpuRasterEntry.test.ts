// FAST-RELEASE FR-A18 (opus-nalati): Nalati's Linux prepare spent 77 s in the in-page server's world boot, its reads stalled
// behind seconds-long software GL frames on the page's main thread (WebKit routes a worker's fetches through it), and 27 s in
// three spawn settle draws where one links every program. The frames wait for the early server only where the reads share
// the page's thread, and a CPU rasterizer settles the spawn view in one draw.
import { expect, test } from 'vitest';
import { workerReadsOnPageThread } from '@wildshard/engine/core/slowGpuPacing';
import { entrySettleDraws } from './settlePrograms';

const WEBKIT_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const CHROMIUM = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

test('WebKit reads a worker\'s fetches on the page thread; Chromium and Firefox do not', () => {
  expect(workerReadsOnPageThread(WEBKIT_LINUX)).toBe(true);
  expect(workerReadsOnPageThread(IPHONE)).toBe(true);
  expect(workerReadsOnPageThread(CHROMIUM)).toBe(false);
  expect(workerReadsOnPageThread(FIREFOX)).toBe(false);
});

test('a CPU rasterizer settles the spawn view in one draw; a GPU keeps three', () => {
  expect(entrySettleDraws(true)).toBe(1);
  expect(entrySettleDraws(false)).toBe(3);
});
