import { hideAndSave, walkTo } from '../smoke/game.ts'
import { enterTemplate, expect, test } from './fixtures.ts'
import { inPlay, poseAt, state } from './probe.ts'

import type { Page } from '@playwright/test'

async function doorIsOpen(page: Page): Promise<boolean> {
  return await page.evaluate(
    (): boolean =>
      globalThis.__wildshard
        ?.area()
        ?.targets.find((target): boolean => target.panel === 'template.door')
        ?.solid === false,
  )
}

async function expectOpenDoor(page: Page): Promise<void> {
  await expect
    .poll(async (): Promise<readonly string[]> => {
      const view = await state(page)
      return view.flags
    })
    .toContain('template.door-open')
  await expect
    .poll(async (): Promise<boolean> => await doorIsOpen(page))
    .toBe(true)
}

async function openDoor(page: Page): Promise<void> {
  const approach = await poseAt(page, 'hut', { z: -4, yaw: Math.PI })
  await walkTo(page, approach.z + 2)
  await page.keyboard.press('KeyE', { delay: 100 })
  await expectOpenDoor(page)
}

test('the hut door flag survives a save and real reload', async ({
  page,
}): Promise<void> => {
  await openDoor(page)
  await hideAndSave(page)
  await page.reload()
  await enterTemplate(page)
  await inPlay(page)
  await expectOpenDoor(page)
})

test('Exit to Title keeps the hut door in an independent save', async ({
  freshPage,
}): Promise<void> => {
  const page = await freshPage()
  await openDoor(page)
  await page.keyboard.press('Escape')
  await page.locator('.ws-gmenu.show:not([inert]) .ws-gmenu-exit').click()
  await enterTemplate(page)
  await expectOpenDoor(page)
})
