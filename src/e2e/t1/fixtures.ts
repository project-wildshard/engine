import { devices, expect, test as base } from '@playwright/test'

import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
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

interface Workers {
  readonly world: SeatedWorld
}

/** Enter the installed Template 1 through the same controls as a player. */
async function enterTemplate(page: Page): Promise<void> {
  await page.locator('.ws-main-select').waitFor()
  const dismiss = page.locator('#wsdrop .dismiss')
  if ((await dismiss.count()) > 0) {
    await dismiss.click()
  }
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
    await skip.click()
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
      value.slug === '_template',
  )
  if (typeof row !== 'object' || row === null || !('name' in row)) {
    throw new Error('The build has no Template 1')
  }
  const cards = await page.locator('.ws-menu-card b').allTextContents()
  const index = cards.indexOf(String(row.name))
  expect(index).toBeGreaterThanOrEqual(0)
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).click()
  await page
    .locator(`.ws-menu-card.selected[data-i="${String(index)}"]`)
    .waitFor()
  await page.locator('.ws-menu-play').click()
  await inPlay(page)
}

async function seat(page: Page): Promise<void> {
  await page.goto('/?mute=1&nolock=1&sw=0&fps=30')
  await enterTemplate(page)
}

async function openWorld(
  browser: Browser,
  baseURL: string,
): Promise<SeatedWorld> {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    baseURL,
  })
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    page.on('console', (message): void => {
      if (message.type() === 'error') {
        errors.push(message.text())
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
  world: [
    async ({ browser }, provide, workerInfo): Promise<void> => {
      const { baseURL } = workerInfo.project.use
      if (baseURL === undefined) {
        throw new Error('Missing T1 origin')
      }
      const world = await openWorld(browser, baseURL)
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
  freshPage: async ({ browser, baseURL }, provide): Promise<void> => {
    if (baseURL === undefined) {
      throw new Error('Missing T1 origin')
    }
    const worlds: SeatedWorld[] = []
    try {
      await provide(async (): Promise<Page> => {
        const world = await openWorld(browser, baseURL)
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

export { enterTemplate, test }
export { expect } from '@playwright/test'
export type { SeatedWorld }
