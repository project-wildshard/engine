import { expect } from './fixtures.ts'
import { poseAt } from './probe.ts'

import type { Page } from '@playwright/test'

// J434: Brasscap's canyon gate (POI `gate`, shared field 101 `brasscap.gate.open`) is the saved door: its use
// (`brasscap.gate.use`, radius 2 at (2, -61.5)) opens it, and its panel `brasscap.gate` stops blocking.
async function gateIsOpen(page: Page): Promise<boolean> {
  return await page.evaluate(
    (): boolean =>
      globalThis.__wildshard
        ?.area()
        ?.targets.find((target): boolean => target.panel === 'brasscap.gate')
        ?.solid === false,
  )
}

// The gate is a shared field, not a flag: `area().flags` stays empty, so its panel is the read.
async function expectOpenGate(page: Page): Promise<void> {
  await expect
    .poll(async (): Promise<boolean> => await gateIsOpen(page))
    .toBe(true)
}

async function openGate(page: Page): Promise<void> {
  // A pose alone shows no prompt: walk the last 2 m in, as a player does.
  await poseAt(page, 'gate', { z: 3, yaw: 0 })
  expect(await gateIsOpen(page)).toBe(false)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(500)
  await page.keyboard.up('KeyW')
  await page.keyboard.press('KeyE', { delay: 100 })
  await expectOpenGate(page)
}

export { expectOpenGate, openGate }
