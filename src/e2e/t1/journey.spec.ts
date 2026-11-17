// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386, Jake 2026-11-16: "there's no regression tests ... for going to the game,
// pressing shard select, pressing driftwood, entering driftwood"): a phone taps from the title through Shard Select and Enter
// World into play, and every sample on the way is a menu, the world's full-screen loading card or play. PZ27b2 failed this on
// v0.1.28 to v0.1.30 (the launch shell on the world page, the main menu back, the HUD over it, a blank wait) while every other
// T1 journey passed, because they only waited for play at the end. scripts/journey-proof.mjs is the same judge on staging.
import { expect, test } from '@playwright/test'

import {
  deckFrames,
  recordDeck,
  swipeProblems,
  touchSwipe,
} from '../../../scripts/bugbash-probes.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import {
  judge,
  label,
  PHONE,
  stickMoves,
  tapJourney,
} from '../../../scripts/journey-proof.mjs'

import type { JourneyPath, Sample } from '../../../scripts/journey-proof.mjs'
import type { Page } from '@playwright/test'

// MAIN-SCREEN MS5 (J399): the same judge on all three ways in: ZONE SELECT and a card, ENTER THE MMO, and the one-zone deep
// link; each must reach the zone's detailed full-screen loading card and play.
async function journey(
  page: Page,
  run: string,
  way: JourneyPath = 'select',
): Promise<void> {
  await page.goto(
    way === 'deeplink'
      ? '/slug/_template?mute=1&nolock=1'
      : '/?mute=1&nolock=1',
  )
  const samples = await tapJourney(page, { card: '_template', path: way })
  const path = samples.map(
    (row: Sample): string => `${String(row.t)}:${label(row.s)}`,
  )
  expect(judge(samples), `${run}: ${path.join(' ')}`).toEqual([])
  expect(await stickMoves(page), `${run}: the stick moves the player`).toBe(
    true,
  )
  await page.goto('about:blank')
}

test('a tapped phone journey shows only menu, loading card and play, cold and warm', async ({
  browser,
  baseURL,
}): Promise<void> => {
  test.setTimeout(480_000)
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    ...(baseURL === undefined ? {} : { baseURL }),
  })
  try {
    // Template 1 is a Developer card; Developer changes no screen on this path
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    await journey(page, 'cold')
    await journey(page, 'warm')
    await journey(page, 'ENTER THE MMO', 'mmo')
    await journey(page, 'deep link', 'deeplink')
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
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
