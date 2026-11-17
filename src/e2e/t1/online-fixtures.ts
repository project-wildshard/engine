import { devices } from '../../../scripts/browser-playwright.mjs'
import { expect, test as base } from '../../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import { openT1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import { enterTemplate } from './fixtures.ts'

import type { T1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import type { Browser, BrowserContext, Page } from '@playwright/test'

interface Entered {
  readonly context: BrowserContext
  readonly page: Page
  readonly errors: readonly string[]
}
interface Peers {
  readonly first: Entered
  readonly second: Entered
}
interface Workers {
  readonly rigGroup: 'session' | 'entry'
  readonly rig: T1OnlineRig
  readonly peers: Peers
}

async function device(browser: Browser, rig: T1OnlineRig): Promise<Entered> {
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
      errors.push(`page: ${error.message}`)
    })
    page.on('console', (message): void => {
      if (message.type() === 'error') {
        errors.push(`console: ${message.text()}`)
      }
    })
    return { context, page, errors }
  } catch (error) {
    await context.close()
    throw error
  }
}

async function enter(
  browser: Browser,
  rig: T1OnlineRig,
  name: string,
): Promise<Entered> {
  const opened = await device(browser, rig)
  try {
    await opened.page.goto('/?mute=1&nolock=1&sw=0&fps=30')
    await enterTemplate(opened.page, name)
    return opened
  } catch (error) {
    await opened.context.close()
    throw error
  }
}

const test = base.extend<object, Workers>({
  rigGroup: ['session', { scope: 'worker', option: true }],
  rig: [
    async ({ browserName, rigGroup }, provide): Promise<void> => {
      expect(browserName).toBe('chromium')
      const dist = process.env['WS_T1_BUILD_DIR']
      if (dist === undefined) {
        throw new Error('Missing shared client build')
      }
      const lane = process.env['WS_LANE_NAME'] ?? 't1-e2e'
      const rig = await openT1OnlineRig(dist, `tmp/${lane}/${rigGroup}`)
      try {
        await provide(rig)
      } finally {
        await rig.close()
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  peers: [
    async ({ browser, rig }, provide): Promise<void> => {
      const first = await enter(browser, rig, 'T1 Alice')
      try {
        const second = await enter(browser, rig, 'T1 Bob')
        try {
          await provide({ first, second })
        } finally {
          await second.context.close()
        }
      } finally {
        await first.context.close()
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

export { device, test }
