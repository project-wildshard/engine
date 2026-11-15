import { errors as playwrightErrors, expect } from '@playwright/test'

import { enterTemplate } from './fixtures.ts'
import { device, test } from './online-fixtures.ts'

import type { T1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import type { Browser, Page } from '@playwright/test'

// Entry errors use a fresh worker/server, retaining the production connection
// limits after the reconnect scenarios in online.spec.ts.
test.use({ rigGroup: 'entry' })

async function seatedResult(page: Page, name: string): Promise<unknown> {
  try {
    await enterTemplate(page, name)
    return undefined
  } catch (error) {
    return error
  }
}

async function load503(
  browser: Browser,
  rig: T1OnlineRig,
  route: 'release' | 'packs',
): Promise<void> {
  const opened = await device(browser, rig)
  const id = route === 'release' ? 'release-5xx' : 'packs-5xx'
  let result: Promise<unknown> | undefined = undefined
  try {
    const before = await rig.matches(route)
    await rig.arm(id, [{ route, kind: 'status', code: 503 }])
    await opened.page.goto('/?mute=1&nolock=1&sw=0&fps=30')
    // Observe the blocked load while keeping an early rejection owned.
    result = seatedResult(opened.page, `T1 ${route}`)
    await expect
      .poll(async (): Promise<number> => await rig.matches(route))
      .toBeGreaterThan(before)
    const screen = opened.page.locator(`[data-failmode~="${id}"]`)
    await expect(screen).toBeVisible({ timeout: 15_000 })
    // A 503 body must never be credited as admitted bytes and reach play.
    const blocked = await opened.page.evaluate(
      (): string | undefined => globalThis.__wildshard?.app.state,
    )
    expect(blocked).not.toBe('play')
    await rig.arm('healthy', [])
    const retry =
      route === 'release'
        ? screen.getByRole('button', { name: /Try/u })
        : opened.page.locator('.ws-load-retry:visible').first()
    try {
      await retry.click({ timeout: 5000 })
    } catch (error) {
      if (!(error instanceof playwrightErrors.TimeoutError)) {
        throw error
      }
    }
    expect(await result).toBeUndefined()
    await expect(screen).toBeHidden()
    expect(
      opened.errors.filter(
        (line): boolean =>
          !line.startsWith(
            'console: Failed to load resource: the server responded with a status of 503',
          ),
      ),
    ).toEqual([])
  } finally {
    await rig.arm('healthy', [])
    await opened.context.close()
    await result
  }
}

test('a matched release 503 shows its page and heals to Template control', async ({
  browser,
  rig,
}): Promise<void> => {
  await load503(browser, rig, 'release')
})

test('a matched pack 503 keeps bad bytes out and heals to Template control', async ({
  browser,
  rig,
}): Promise<void> => {
  await load503(browser, rig, 'packs')
})
