import { setTimeout as delay } from 'node:timers/promises'

import { devices } from '../../scripts/browser-playwright.mjs'
import { expect, test as base } from '../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../scripts/debug-settings.mjs'
import { recordBars } from '../../scripts/loading-card-recorder.mjs'
import { recordImageUploads } from '../../scripts/memory/uploadRecorder.mjs'
import { plantDecodeDelay, reportBoot } from './boot-report.ts'
import { watchClones } from './clones.ts'
import { inPlay } from './probe.ts'

import type { Browser, BrowserContext, Page } from '@playwright/test'

interface SeatedWorld {
  readonly context: BrowserContext
  readonly page: Page
  readonly errors: readonly string[]
}

interface Fixtures {
  readonly freshPage: () => Promise<Page>
}

type DeviceProfile = 'desktop' | 'phone'

interface WorldOptions {
  readonly profile: DeviceProfile
  readonly entryDelayMs: number
}

interface Workers {
  readonly world: SeatedWorld
  readonly deviceProfile: DeviceProfile
  readonly entryDelayMs: number
}

const dropHandled = new WeakSet<Page>()

/** Enter the installed Brasscap through the same controls as a player. */
async function enterBrasscap(page: Page, name?: string): Promise<void> {
  // The title's drop modal ("Unexpectedly back at the title": a reload after a page went hidden, as `hideAndSave` fakes)
  // can mount after the title's controls do. A one-off check missed it under load and the next click waited behind it
  // for the whole test (TR-4b), so dismiss it, as a player does, whenever it covers an action.
  if (!dropHandled.has(page)) {
    dropHandled.add(page)
    await page.addLocatorHandler(
      page.locator('#wsdrop .dismiss'),
      async (dismiss): Promise<void> => {
        await dismiss.click()
      },
    )
  }
  await page.locator('.ws-main-select').waitFor()
  const developer = page.locator('.ws-main-dev')
  if ((await developer.getAttribute('aria-checked')) !== 'true') {
    await developer.click()
  }
  await page.locator('.ws-main-select').click()
  const skip = page.locator('#ws-name-box [data-name=skip]')
  await page
    .locator('#ws-name-box, .ws-title-stack[data-screen="select"]')
    .first()
    .waitFor()
  if ((await skip.count()) > 0) {
    if (name === undefined) {
      await skip.click()
    } else {
      await page.locator('#ws-name-box input').fill(name)
      await page.locator('#ws-name-box button[type=submit]').click()
    }
  }
  const catalogue: unknown = JSON.parse(
    (await page.locator('#ws-title-rows').textContent()) ?? 'null',
  )
  if (!Array.isArray(catalogue)) {
    throw new TypeError('Missing title catalogue')
  }
  const row: unknown = catalogue.find(
    (value: unknown): boolean =>
      typeof value === 'object' &&
      value !== null &&
      'slug' in value &&
      value.slug === 'brasscap-mesa',
  )
  if (typeof row !== 'object' || row === null || !('name' in row)) {
    throw new Error('The build has no Brasscap')
  }
  // ZS10: Brasscap is a preview zone outside FEATURED; Developer's ALL lists every zone
  await page.locator('.ws-menu-tab[data-tab="all"]').click()
  const cards = await page.locator('.ws-menu-card b').allTextContents()
  const index = cards.indexOf(String(row.name))
  expect(index).toBeGreaterThanOrEqual(0)
  // ALL (J469) is a list: its rows are tapped
  await page.locator(`.ws-menu-card[data-i="${String(index)}"]`).click()
  await page
    .locator(`.ws-menu-card.selected[data-i="${String(index)}"]`)
    .waitFor()
  const startedAt = Date.now()
  await page.locator('.ws-menu-play').click()
  await inPlay(page)
  await reportBoot(page, startedAt)
}

async function seat(page: Page): Promise<void> {
  await page.goto('/?mute=1&nolock=1&sw=0&fps=30')
  await enterBrasscap(page)
}

async function openWorld(
  browser: Browser,
  baseURL: string,
  options: WorldOptions,
): Promise<SeatedWorld> {
  const { profile, entryDelayMs } = options
  const context = await browser.newContext({
    ...devices[profile === 'phone' ? 'iPhone 16 Pro' : 'Desktop Chrome'],
    ...(profile === 'phone' ? { viewport: { width: 402, height: 874 } } : {}),
    baseURL,
  })
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await saveFixture(context, {
      scope: 'device',
      key: 'firstPlayDone',
      data: true,
    })
    await harnessPins(context, { seed: 357 })
    if (profile === 'phone') {
      await context.addInitScript(recordBars)
      // EM26: shard textures uploaded as decoded RGBA
      await context.addInitScript(recordImageUploads)
    }
    if (process.env['WS_T1_FAULT'] === 'decode-delay') {
      await context.addInitScript(plantDecodeDelay)
    }
    if (entryDelayMs > 0) {
      await context.route('**/*.js', async (route): Promise<void> => {
        if (
          /\/entry-[^/]+\.js$/u.test(new URL(route.request().url()).pathname)
        ) {
          await delay(entryDelayMs)
        }
        await route.continue()
      })
    }
    const page = await context.newPage()
    if (profile === 'phone') {
      // EM25: worker messages that clone big buffers, page and workers
      await watchClones(context, page)
    }
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    page.on('console', (message): void => {
      if (message.type() === 'error') {
        errors.push(message.text())
      }
      // TR-4b: a stalled boot names its open operations; a suite the runner kills keeps only stdout
      if (message.text().startsWith('[boot] stalled')) {
        process.stdout.write(`[t1-stall] ${message.text()}\n`)
      }
    })
    await seat(page)
    expect(errors).toEqual([])
    return { context, page, errors }
  } catch (error) {
    await context.close()
    throw error
  }
}

/** A worker keeps one seated world; independent saves need freshPage. */
const test = base.extend<Fixtures, Workers>({
  deviceProfile: ['desktop', { scope: 'worker', option: true }],
  entryDelayMs: [0, { scope: 'worker', option: true }],
  world: [
    async (
      { browser, deviceProfile, entryDelayMs },
      provide,
      workerInfo,
    ): Promise<void> => {
      const { baseURL } = workerInfo.project.use
      if (baseURL === undefined) {
        throw new Error('Missing T1 origin')
      }
      const world = await openWorld(browser, baseURL, {
        profile: deviceProfile,
        entryDelayMs,
      })
      try {
        await provide(world)
      } finally {
        await world.context.close()
      }
    },
    { scope: 'worker' },
  ],
  page: async ({ world }, provide): Promise<void> => {
    await provide(world.page)
    expect(world.errors).toEqual([])
  },
  freshPage: async (
    { browser, baseURL, deviceProfile, entryDelayMs },
    provide,
  ): Promise<void> => {
    if (baseURL === undefined) {
      throw new Error('Missing T1 origin')
    }
    const worlds: SeatedWorld[] = []
    try {
      await provide(async (): Promise<Page> => {
        const world = await openWorld(browser, baseURL, {
          profile: deviceProfile,
          entryDelayMs,
        })
        worlds.push(world)
        return world.page
      })
    } finally {
      await Promise.all(
        worlds.map(async (world): Promise<void> => {
          await world.context.close()
          expect(world.errors).toEqual([])
        }),
      )
    }
  },
})

/** The phone's seated world. Every phone spec imports this one test, so the suite boots that world once: two files'
 *  own `test.use` calls made two worker pools, and C booted the same phone world twice, about 53 s each on the hosted
 *  runners' software GL (TR-4b). The loading-stall fault holds its entry module 6 s, past both stall limits
 *  (loading-bar-rule.mjs), for the phone bar spec to catch. */
const phoneTest = test.extend({
  deviceProfile: ['phone', { scope: 'worker' }],
  entryDelayMs: [
    process.env['WS_T1_FAULT'] === 'loading-stall' ? 6000 : 0,
    { scope: 'worker' },
  ],
})

export { enterBrasscap, phoneTest, test }
export { expect } from '@playwright/test'
export type { SeatedWorld }
