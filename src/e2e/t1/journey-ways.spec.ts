// MAIN-SCREEN MS5 (J399), the two ways in besides ZONE SELECT: ENTER THE MMO and the one-zone deep link each reach the
// zone's detailed full-screen loading card and play, every sample a menu, the loading card or play (journey.ts's judge).
// Split from journey.spec.ts so each suite fits its 120 s hosted budget (TR-4); here they open one page, MMO first.
import { test } from '../../scripts/browser-test.mjs'
import { journey, phoneJourneys } from './journey.ts'

test('ENTER THE MMO and the deep link show only menu, loading card and play', async ({
  browser,
  baseURL,
}): Promise<void> => {
  test.setTimeout(120_000)
  await phoneJourneys(browser, baseURL, async (page): Promise<void> => {
    await journey(page, 'ENTER THE MMO', 'mmo')
    await journey(page, 'deep link', 'deeplink')
  })
})
