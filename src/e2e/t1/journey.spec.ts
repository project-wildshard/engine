// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386, Jake 2026-11-16: "there's no regression tests ... for going to the game,
// pressing shard select, pressing driftwood, entering driftwood"): a phone taps from the title through Shard Select and Enter
// World into play, and every sample on the way is a menu, the world's full-screen loading card or play. PZ27b2 failed this on
// v0.1.28 to v0.1.30 (the launch shell on the world page, the main menu back, the HUD over it, a blank wait) while every other
// T1 journey passed, because they only waited for play at the end. scripts/journey-proof.mjs is the same judge on staging.
import { expect, test } from '../../../scripts/browser-test.mjs'
import {
  deckFrames,
  recordDeck,
  swipeProblems,
  touchSwipe,
} from '../../../scripts/bugbash-probes.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import { PHONE } from '../../../scripts/journey-proof.mjs'
import { journey, phoneJourneys } from './journey.ts'

// MAIN-SCREEN MS5 (J399): ZONE SELECT and a card, cold then warm. The other two ways in, ENTER THE MMO and the one-zone
// deep link, are journey-ways.spec.ts (suite F): one 120 s hosted suite cannot hold all four boots (TR-4).
test('a tapped phone journey shows only menu, loading card and play, cold and warm', async ({
  browser,
  baseURL,
}): Promise<void> => {
  test.setTimeout(120_000)
  await phoneJourneys(browser, baseURL, async (page): Promise<void> => {
    await journey(page, 'cold')
    await journey(page, 'warm')
  })
})

// STAGING-BUGBASH SB14 (Jake's 12:52 recording): mid-swipe on Shard Select two cards showed at once, the one off the middle
// See-through over the hero (the ghost). A real touch swipe at 402x874: every frame has exactly one lit card, no card is
// See-through, no two cards overlap past 150 ms, and the deck rests with the next card centred.
test('a touch swipe on Shard Select shows one lit, solid card and rests centred', async ({
  browser,
  baseURL,
}): Promise<void> => {
  test.setTimeout(120_000)
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    ...(baseURL === undefined ? {} : { baseURL }),
  })
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    await page.goto('/?mute=1&nolock=1')
    await page.locator('.ws-main-select').tap()
    await page
      .locator('#ws-name-box, .ws-title-stack[data-screen="select"]')
      .first()
      .waitFor({ timeout: 15_000 })
    const skip = page.locator('#ws-name-box [data-name=skip]')
    if (await skip.isVisible()) {
      await skip.tap()
    }
    await page
      .locator('.ws-title-stack[data-screen="select"]')
      .waitFor({ timeout: 15_000 })
    await page.locator('.ws-menu-dots i[data-i="0"]').tap()
    await page.waitForTimeout(800)
    const lit = page.locator('.ws-menu-card.selected')
    const box = await lit.boundingBox()
    if (box === null) {
      throw new Error('No selected card')
    }
    await page.evaluate(recordDeck, 240)
    const released = await touchSwipe(page, box.y + box.height / 2)
    await page.waitForTimeout(900)
    const frames = await page.evaluate(deckFrames)
    expect(swipeProblems(frames, released)).toEqual([])
    expect(await lit.getAttribute('data-i')).toBe('1')
    const rest = await lit.boundingBox()
    const centre = (rest?.x ?? 0) + (rest?.width ?? 0) / 2
    expect(Math.abs(centre - PHONE.viewport.width / 2)).toBeLessThan(1)
  } finally {
    await context.close()
  }
})
