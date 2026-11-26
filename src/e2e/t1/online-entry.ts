import { errors as playwrightErrors, expect } from '@playwright/test'

import { reportBoot } from './boot-report.ts'
import { enterBrasscap } from './fixtures.ts'
import { device } from './online-fixtures.ts'

import type { T1OnlineRig } from '../../scripts/t1-online-rig.mjs'
import type { Browser, Page } from '@playwright/test'

async function seatedResult(page: Page, name: string): Promise<unknown> {
  try {
    await enterBrasscap(page, name)
    return undefined
  } catch (error) {
    return error
  }
}

export async function load503(
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
    const startedAt = Date.now()
    await opened.page.goto('/?mute=1&nolock=1&sw=0&fps=30')
    // Observe the blocked load while keeping an early rejection owned.
    result = seatedResult(opened.page, `T1 ${route}`)
    const screen = opened.page.locator(`[data-failmode~="${id}"]`)
    const seen = Symbol('fault screen observed')
    // The release can be read again at dial, after software GL finishes booting.
    // Judge the observed screen against actual control within the suite budget.
    await expect(
      Promise.race([screen.waitFor().then((): typeof seen => seen), result]),
    ).resolves.toBe(seen)
    // TR-4b: how long the blocked load took to say so, and where that load stood
    await reportBoot(opened.page, startedAt, `${id} page shown`)
    expect(await rig.matches(route)).toBeGreaterThan(before)
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
