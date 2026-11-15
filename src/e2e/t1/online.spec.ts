import { errors as playwrightErrors, expect } from '@playwright/test'

import { enterTemplate } from './fixtures.ts'
import { device, test } from './online-fixtures.ts'

import type { T1OnlineRig } from '../../../scripts/t1-online-rig.mjs'
import type { Browser, Page } from '@playwright/test'

test('two Template pages see bodies, names and chat on memory saves', async ({
  peers,
}): Promise<void> => {
  const { first, second } = peers
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
})

function expectInjectedSocketErrors(errors: readonly string[]): void {
  expect(
    errors.filter(
      (line): boolean =>
        !/^console: WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/' failed:/u.test(
          line,
        ),
    ),
  ).toEqual([])
}

test('a real dropped Template socket shows its strip and recovers', async ({
  peers,
  rig,
}): Promise<void> => {
  const { first, second } = peers
  const firstErrors = first.errors.length,
    secondErrors = second.errors.length
  try {
    const before = await rig.matches('socket')
    await rig.arm('drop', [{ route: 'socket', kind: 'drop-after', afterMs: 0 }])
    await expect
      .poll(async (): Promise<number> => await rig.matches('socket'))
      .toBeGreaterThan(before)
    await rig.arm('drop-held', [
      { route: 'socket', kind: 'refuse-upgrade', code: 503 },
    ])
    await expect(first.page.locator('[data-failmode~="drop"]')).toBeVisible()
    await rig.arm('healthy', [])
    await expect(first.page.locator('[data-failmode~="drop"]')).toBeHidden({
      timeout: 30_000,
    })
    const frame = await first.page.evaluate(
      (): number => globalThis.__workerClient?.().frames ?? 0,
    )
    await first.page.waitForFunction(
      (previous): boolean =>
        (globalThis.__workerClient?.().frames ?? 0) > previous + 5,
      frame,
    )
    // A line received by the other page proves the recovered link carried real traffic.
    await first.page.locator('#ws-chat input').fill('recovered after drop')
    await first.page.locator('#ws-chat input').press('Enter')
    await expect(second.page.locator('#ws-chat')).toContainText(
      'T1 Alice: recovered after drop',
    )
    expectInjectedSocketErrors(first.errors.slice(firstErrors))
    expectInjectedSocketErrors(second.errors.slice(secondErrors))
  } finally {
    await rig.arm('healthy', [])
  }
})

test('browser offline shows its card and recovers online', async ({
  peers,
}): Promise<void> => {
  const { first, second } = peers
  const before = first.errors.length
  try {
    await first.context.setOffline(true)
    const online: unknown = await first.page.evaluate('navigator.onLine')
    expect(online).toBe(false)
    await expect(
      first.page.locator('[data-failmode~="offline-play"]'),
    ).toBeVisible({ timeout: 8000 })
    await first.context.setOffline(false)
    await expect(
      first.page.locator('[data-failmode~="offline-play"]'),
    ).toBeHidden({ timeout: 30_000 })
    await first.page.locator('#ws-chat input').fill('recovered after offline')
    await first.page.locator('#ws-chat input').press('Enter')
    await expect(second.page.locator('#ws-chat')).toContainText(
      'T1 Alice: recovered after offline',
    )
    const errors = first.errors
      .slice(before)
      .filter(
        (line): boolean =>
          !line.startsWith(
            'console: Failed to load resource: net::ERR_INTERNET_DISCONNECTED',
          ),
      )
    expectInjectedSocketErrors(errors)
  } finally {
    await first.context.setOffline(false)
  }
})

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
