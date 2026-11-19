// The save step the T1 saves suite shares (src/e2e/t1/saves.spec.ts). J434 retired the Template 2 smoke that also lived
// here (T2E-2, scripts/e2e-client.mjs). Page globals are typed in page-globals.d.ts.
import type { Page } from '@playwright/test'

/** Each in-world wait fails on its own within this, so a planted fault names its step, not the test's timeout. */
const STEP = { timeout: 30_000 }

/** A phone's only warning before it closes a page is a hide, and the page saves on it (clientWorker.ts). Headless
 * Chromium never hides a tab, so this sends the same event to the same listeners and waits for that save to land. */
async function hideAndSave(page: Page): Promise<void> {
  const before = await page.evaluate(
    (): number => globalThis.__workerClient?.().savedTick ?? -1,
  )
  await page.evaluate((): void => {
    Object.defineProperty(globalThis.document, 'visibilityState', {
      get: (): string => 'hidden',
      configurable: true,
    })
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
  })
  await page.waitForFunction(
    (tick): boolean => {
      const report = globalThis.__workerClient?.()
      return report !== undefined && report.savedOk && report.savedTick > tick
    },
    before,
    STEP,
  )
}

export { hideAndSave }
