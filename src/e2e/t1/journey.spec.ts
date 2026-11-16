// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386, Jake 2026-11-16: "there's no regression tests ... for going to the game,
// pressing shard select, pressing driftwood, entering driftwood"): a phone taps from the title through Shard Select and Enter
// World into play, and every sample on the way is a menu, the world's full-screen loading card or play. PZ27b2 failed this on
// v0.1.28 to v0.1.30 (the launch shell on the world page, the main menu back, the HUD over it, a blank wait) while every other
// T1 journey passed, because they only waited for play at the end. scripts/journey-proof.mjs is the same judge on staging.
import { expect, test } from '@playwright/test'

import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import {
  judge,
  label,
  PHONE,
  stickMoves,
  tapJourney,
} from '../../../scripts/journey-proof.mjs'

import type { Sample } from '../../../scripts/journey-proof.mjs'
import type { Page } from '@playwright/test'

async function journey(page: Page, run: string): Promise<void> {
  await page.goto('/?mute=1&nolock=1')
  const samples = await tapJourney(page, { card: '_template' })
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
  test.setTimeout(240_000)
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
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
})
