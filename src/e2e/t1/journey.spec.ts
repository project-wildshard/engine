// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386, Jake 2026-11-16: "there's no regression tests ... for going to the game,
// pressing shard select, pressing driftwood, entering driftwood"): a phone taps from the title through Shard Select and Enter
// World into play, and every sample on the way is a menu, the world's full-screen loading card or play. PZ27b2 failed this on
// v0.1.28 to v0.1.30 (the launch shell on the world page, the main menu back, the HUD over it, a blank wait) while every other
// T1 journey passed, because they only waited for play at the end. scripts/journey-proof.mjs is the same judge on staging.
import { readFileSync } from 'node:fs'

import { expect, test } from '../../../scripts/browser-test.mjs'
import {
  deckFrames,
  recordDeck,
  swipeProblems,
  touchSwipe,
} from '../../../scripts/bugbash-probes.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import { PHONE } from '../../../scripts/journey-proof.mjs'
import {
  journey,
  markedZoneSelectPress,
  phoneJourneys,
  startTapScript,
  tapIntoZone,
  zoneAddresses,
} from './journey.ts'

import type { Page } from '@playwright/test'

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

test('a marked phone sends one funnel observation when it taps Enter Zone', async ({
  browser,
  baseURL,
}): Promise<void> => {
  await markedZoneSelectPress(browser, baseURL)
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

// ZONE-SELECT-SERVED ZS10 (J461, J468, J469): on the preview build at the phone viewport, Zone Select opens on FEATURED, each tab
// shows its own cards in the room list's order, and ENTER ZONE enters a zone from every tab (the travel to its page). The page's
// baked list is the pinned staging snapshot, as a release bakes it (scripts/app-build/catalogue.ts), with NEW holding every zone
// FEATURED does not, so each tab holds some of whatever ring the build carries.
interface Served {
  readonly featured: readonly string[]
  readonly popular: readonly string[]
  readonly new: readonly string[]
  readonly all: readonly string[]
  readonly baked: string
}
function slugs(rows: unknown): string[] {
  return Array.isArray(rows)
    ? rows.flatMap((row: unknown): string[] =>
        typeof row === 'object' &&
        row !== null &&
        'slug' in row &&
        typeof row.slug === 'string'
          ? [row.slug]
          : [],
      )
    : []
}
function servedZones(): Served {
  const pinned: unknown = JSON.parse(
    readFileSync('test/pins/zone-select.json', 'utf8'),
  )
  if (
    typeof pinned !== 'object' ||
    pinned === null ||
    !('all' in pinned) ||
    !('featured' in pinned) ||
    !('popular' in pinned) ||
    !Array.isArray(pinned.all)
  ) {
    throw new TypeError('No pinned Zone Select list')
  }
  const featured = slugs(pinned.featured)
  const fresh: unknown[] = pinned.all.filter(
    (row: unknown): boolean => !featured.includes(slugs([row])[0] ?? ''),
  )
  return {
    featured,
    popular: slugs(pinned.popular),
    new: slugs(fresh),
    all: slugs(pinned.all),
    baked: JSON.stringify({ ...pinned, new: fresh }).replaceAll(
      '<',
      String.raw`<`,
    ),
  }
}

/** Open Zone Select, press `tab`, check its cards keep `order`, pick its second enterable card (by a mini hero, or ALL's row),
 *  shoot it and ENTER ZONE; the slug the page travelled to. */
async function enterFromTab(
  page: Page,
  tab: 'featured' | 'popular' | 'new' | 'all',
  order: readonly string[],
): Promise<string> {
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
  await expect(
    page.locator('.ws-menu-tab[aria-selected="true"]'),
  ).toHaveAttribute('data-tab', 'featured')
  const button = page.locator(`.ws-menu-tab[data-tab="${tab}"]`)
  await button.tap({ timeout: 5000 })
  await expect(button).toHaveAttribute('aria-selected', 'true')
  const shown = await page.locator('.ws-menu-card[data-slug]').evaluateAll(
    (
      cards: readonly {
        readonly dataset: { readonly slug?: string }
      }[],
    ): string[] =>
      cards.map(
        (card: { readonly dataset: { readonly slug?: string } }): string =>
          card.dataset.slug ?? '',
      ),
  )
  const served = shown.filter((slug: string): boolean => order.includes(slug))
  const ranks = served.map((slug: string): number => order.indexOf(slug))
  expect(ranks, `${tab} keeps the room list's order`).toEqual(
    ranks.toSorted((left: number, right: number): number => left - right),
  )
  const open = page.locator('.ws-menu-card[data-enters="1"]')
  const count = await open.count()
  expect(count, `${tab} has a zone to enter`).toBeGreaterThan(0)
  const at =
    (await open.nth(Math.min(1, count - 1)).getAttribute('data-i')) ?? ''
  const pick =
    tab === 'all'
      ? `.ws-menu-card[data-i="${at}"]`
      : `.ws-menu-dots i[data-i="${at}"]`
  await page.locator(pick).tap({ timeout: 5000 })
  const lit = page.locator(`.ws-menu-card.selected[data-i="${at}"]`)
  await expect(lit).toHaveCount(1)
  const slug = (await lit.getAttribute('data-slug')) ?? ''
  await page.waitForTimeout(500)
  await page.screenshot({ path: test.info().outputPath(`zs10-${tab}.png`) })
  await tapIntoZone(page, page.locator('.ws-menu-play'), slug)
  return slug
}

test('Zone Select switches FEATURED, POPULAR, NEW and ALL, and enters a zone from each', async ({
  browser,
  baseURL,
}): Promise<void> => {
  test.setTimeout(120_000)
  const served = servedZones()
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    ...(baseURL === undefined ? {} : { baseURL }),
  })
  try {
    // ALL is Developer's (J469)
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    await context.route('**/?mute=1*', async (route): Promise<void> => {
      const reply = await route.fetch()
      const text = await reply.text()
      const html = text.replace(
        '</head>',
        `<script type="application/json" id="ws-zone-select">${served.baked}</script></head>`,
      )
      await route.fulfill({ response: reply, body: html })
    })
    await context.addInitScript(startTapScript)
    const page = await context.newPage()
    const named = zoneAddresses(page)
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    const featured = await enterFromTab(page, 'featured', served.featured)
    const popular = await enterFromTab(page, 'popular', served.popular)
    const fresh = await enterFromTab(page, 'new', served.new)
    const all = await enterFromTab(page, 'all', served.all)
    expect(served.featured).toContain(featured)
    expect(served.popular).toContain(popular)
    expect(served.new).toContain(fresh)
    expect(served.featured).not.toContain(fresh)
    expect(all).not.toBe('')
    expect(errors).toEqual([])
    expect(named, 'no address names a zone (J522)').toEqual([])
  } finally {
    await context.close()
  }
})
