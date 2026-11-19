// The phone journey judge T1's E and F suites share (journey.spec.ts, journey-ways.spec.ts): BUGBASH-LOOP's tapped path
// from the title into play, where every sample is a menu, the world's full-screen loading card or play.
import { expect } from '../../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import {
  judge,
  label,
  PHONE,
  stickMoves,
  tapJourney,
} from '../../../scripts/journey-proof.mjs'

import type { JourneyPath, Sample } from '../../../scripts/journey-proof.mjs'
import type { Browser, Page } from '@playwright/test'

// MAIN-SCREEN MS5 (J399): the same judge on all three ways in: ZONE SELECT and a card, ENTER THE MMO, and the one-zone deep
// link; each must reach the zone's detailed full-screen loading card and play.
async function journey(
  page: Page,
  run: string,
  way: JourneyPath = 'select',
): Promise<void> {
  await page.goto(
    way === 'deeplink'
      ? '/slug/brasscap-mesa?mute=1&nolock=1'
      : '/?mute=1&nolock=1',
  )
  const samples = await tapJourney(page, { card: 'brasscap-mesa', path: way })
  const path = samples.map(
    (row: Sample): string => `${String(row.t)}:${label(row.s)}`,
  )
  expect(judge(samples), `${run}: ${path.join(' ')}`).toEqual([])
  expect(await stickMoves(page), `${run}: the stick moves the player`).toBe(
    true,
  )
  await page.goto('about:blank')
}

/** Run `ways` (journeys, in order) on one phone page, as a player taps them; the page raises no error throughout. */
async function phoneJourneys(
  browser: Browser,
  baseURL: string | undefined,
  ways: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    ...(baseURL === undefined ? {} : { baseURL }),
  })
  try {
    // Brasscap is a Developer card; Developer changes no screen on this path
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    await ways(page)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}

export { journey, phoneJourneys }
