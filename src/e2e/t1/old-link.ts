// CHUNK-PARAM-REMOVAL CP22 (J522): no address names a zone. An old `?chunk=` link (a bookmark, a shared URL) is the plain
// title: no world boots, no seat is taken, no modal says why, and the address stays as it came.
import { setTimeout as delay } from 'node:timers/promises'

import { devices } from '../../scripts/browser-playwright.mjs'
import { expect } from '../../scripts/browser-test.mjs'

import type { Browser } from '@playwright/test'

/** The old link this proof opens: a zone the title lists, which a page before CP22 booted at once. */
const OLD_LINK = '?chunk=pine-hollow&mute=1&nolock=1&fps=30'

/** Open `origin`'s old `?chunk=` link and prove it is the title; returns the address the page shows. */
async function oldLinkIsTitle(
  browser: Browser,
  origin: string,
): Promise<string> {
  const context = await browser.newContext({ ...devices['Desktop Chrome'] })
  try {
    const page = await context.newPage()
    const url = new URL(`/${OLD_LINK}`, origin).toString()
    await page.goto(url)
    await page.locator('.ws-main-select').waitFor()
    // A boot would have left the title by now; the page stays on it
    await delay(1500)
    expect(await page.locator('.ws-main-select').isVisible()).toBe(true)
    expect(await page.locator('#wsdrop').count(), 'no modal').toBe(0)
    expect(
      await page.evaluate(
        (): string | undefined => globalThis.__wildshard?.app.state,
      ),
      'no world',
    ).not.toBe('play')
    expect(page.url(), 'the address as it came').toBe(url)
    return page.url()
  } finally {
    await context.close()
  }
}

export { oldLinkIsTitle }
