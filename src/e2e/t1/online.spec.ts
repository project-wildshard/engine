import { devices, expect, test as base } from '@playwright/test'

import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import { openT1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import { enterTemplate } from './fixtures.ts'

import type { T1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import type { Browser, BrowserContext, Page } from '@playwright/test'

const test = base.extend<object, { readonly rig: T1OnlineRig }>({
  rig: [
    async ({ browserName }, provide): Promise<void> => {
      expect(browserName).toBe('chromium')
      const dist = process.env['WS_T1_BUILD_DIR']
      if (dist === undefined) {
        throw new Error('Missing shared client build')
      }
      const lane = process.env['WS_LANE_NAME'] ?? 't1-e2e'
      const rig = await openT1OnlineRig(dist, `tmp/${lane}`)
      try {
        await provide(rig)
      } finally {
        await rig.close()
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

async function enter(
  browser: Browser,
  rig: T1OnlineRig,
  name: string,
): Promise<{
  readonly context: BrowserContext
  readonly page: Page
  readonly errors: readonly string[]
}> {
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    baseURL: rig.base,
  })
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await saveFixture(context, {
      scope: 'device',
      key: 'firstPlayDone',
      data: true,
    })
    await harnessPins(context, { seed: 357 })
    await context.addInitScript((stamp): void => {
      Reflect.set(globalThis, '__WS_WORLD__', stamp)
    }, rig.stamp)
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
    await page.goto('/?mute=1&nolock=1&sw=0&fps=30')
    await enterTemplate(page, name)
    return { context, page, errors }
  } catch (error) {
    await context.close()
    throw error
  }
}

test('two Template pages see bodies, names and chat on memory saves', async ({
  browser,
  rig,
}): Promise<void> => {
  const first = await enter(browser, rig, 'T1 Alice')
  try {
    const second = await enter(browser, rig, 'T1 Bob')
    try {
      const pairs = [
        [first.page, 'T1 Bob'],
        [second.page, 'T1 Alice'],
      ] as const
      await Promise.all(
        pairs.map(async ([page, name]): Promise<void> => {
          await page.waitForFunction(
            (wanted): boolean =>
              globalThis
                .__onlinePlayers?.()
                .some((row): boolean => row.name === wanted && row.modelled) ??
              false,
            name,
          )
        }),
      )
      await second.page.locator('#ws-chat input').fill('hello from Template')
      await second.page.locator('#ws-chat input').press('Enter')
      await expect(first.page.locator('#ws-chat')).toContainText(
        'T1 Bob: hello from Template',
      )
      await expect(second.page.locator('#ws-chat')).toContainText(
        'T1 Bob: hello from Template',
      )
      expect(first.errors).toEqual([])
      expect(second.errors).toEqual([])
    } finally {
      await second.context.close()
    }
  } finally {
    await first.context.close()
  }
})
