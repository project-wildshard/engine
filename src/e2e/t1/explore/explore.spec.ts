import { expect, test } from '../../../../scripts/browser-test.mjs'

import type { Locator, Page } from '@playwright/test'

test.use({ viewport: { width: 800, height: 600 } })

/** Exercise the button handler without pointer or focus animation. */
async function activate(button: Locator): Promise<void> {
  await expect(button).toBeVisible()
  await expect(button).toBeEnabled()
  await button.dispatchEvent('click')
}

async function cameraXZ(page: Page): Promise<readonly [number, number]> {
  return await page.evaluate((): readonly [number, number] => {
    const camera = globalThis.__wildshard?.world?.game.camera.position
    if (camera === undefined) {
      throw new Error('The Explore camera is not ready')
    }
    return [camera.x, camera.z] as const
  })
}

test('Explore browses, flies and inspects without a socket or durable saves', async ({
  page,
}): Promise<void> => {
  const sockets: string[] = []
  page.on('websocket', (socket): void => {
    sockets.push(socket.url())
  })
  await page.addInitScript(`(() => {
    const overlay = '.ws-quest-reward.show, .ws-game-toast:not(.ws-game-toast-warn)';
    const observer = new MutationObserver(() => {
      if (document.querySelector(overlay) === null) return;
      document.documentElement.dataset.gameplayNoticeSeen = 'true';
      observer.disconnect();
    });
    observer.observe(document, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
  })()`)
  await page.goto('/')
  const list = page
    .getByRole('main')
    .filter({ has: page.getByRole('heading', { name: 'Explore Wildshard' }) })
  const dunes = list.getByRole('link', { name: 'Signal Dunes' })
  await expect(dunes).toBeVisible({ timeout: 15_000 })
  await dunes.click()
  const viewer = page.locator('.ws-x.show')
  await expect(viewer).toHaveAttribute('data-mode', 'hub', { timeout: 65_000 })

  await activate(viewer.getByRole('button', { name: /World explorer/u }))
  await expect(viewer).toHaveAttribute('data-mode', 'world')
  const [x, z] = await cameraXZ(page)
  await page.keyboard.down('KeyW')
  try {
    // This proves movement. Software rendering advances only a few frames per second.
    await expect
      .poll(
        async (): Promise<number> => {
          const [nextX, nextZ] = await cameraXZ(page)
          return Math.hypot(nextX - x, nextZ - z)
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0.5)
  } finally {
    await page.keyboard.up('KeyW')
  }

  await activate(viewer.getByRole('button', { name: 'Models', exact: true }))
  const model = viewer.locator('button.ws-x-model').first()
  await activate(model)
  await expect(viewer.locator('.ws-x-sheet .ws-x-name')).toHaveText(/\S/u)
  const saves: unknown = await page.evaluate(`(async () => {
    const keys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)];
    const databases = await indexedDB.databases();
    return [
      ...keys.filter(key => key.startsWith('wildshard.save')),
      ...databases.filter(database => database.name?.startsWith('wildshard-saves')),
    ];
  })()`)
  expect(saves).toEqual([])
  expect(
    await page.locator('html').getAttribute('data-gameplay-notice-seen'),
  ).toBeNull()
  await activate(viewer.getByRole('button', { name: /Catalog/u }))
  await activate(viewer.getByRole('button', { name: 'Back', exact: true }))
  await expect(viewer).toHaveAttribute('data-mode', 'hub')
  await activate(
    viewer.getByRole('button', { name: 'Back to zones', exact: true }),
  )
  await expect(list.getByRole('link', { name: 'Signal Dunes' })).toBeVisible()
  expect(sockets).toEqual([])
})

// Meta CHUNK-PARAM-REMOVAL CP6 (J522, J463): a zone's own Explore link opens its hub with no zone in the query
// (WS_T1_EXPLORE_ZONE picks another pinned zone; ring 1 pins Brasscap Mesa)
const ZONE = `/${process.env['WS_T1_EXPLORE_ZONE'] ?? 'brasscap-mesa'}`
test('An Explore zone link opens its hub and never writes a chunk address', async ({
  page,
}): Promise<void> => {
  const addresses: string[] = []
  page.on('framenavigated', (): void => {
    addresses.push(page.url())
  })
  await page.goto(ZONE)
  const viewer = page.locator('.ws-x.show')
  await expect(viewer).toHaveAttribute('data-mode', 'hub', { timeout: 65_000 })
  addresses.push(page.url())
  expect(new URL(page.url()).pathname).toBe(ZONE)
  expect(addresses.filter((url): boolean => /[?&]chunk=/u.test(url))).toEqual(
    [],
  )
})
