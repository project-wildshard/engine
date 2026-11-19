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

// The HUD's use prompt, as the player reads it: `play.ts` presses E on the nearest interactable it last drew.
async function gatePromptShown(page: Page): Promise<void> {
  await page.waitForFunction(
    (): boolean => {
      const hud: unknown = Reflect.get(
        globalThis.__wildshard?.world ?? {},
        'hud',
      )
      const text: unknown =
        typeof hud === 'object' && hud !== null
          ? Reflect.get(hud, 'promptText')
          : ''
      return typeof text === 'string' && text.includes('canyon gate')
    },
    undefined,
    { timeout: 20_000 },
  )
}

async function openGate(page: Page): Promise<void> {
  // A pose alone shows no prompt: walk in until the gate's prompt shows, then press E, as a player does. A fixed
  // 500 ms walk tied the press to the frame rate: on hosted software GL the gate stayed shut (TR-4b, run 44527365455).
  await poseAt(page, 'gate', { z: 3, yaw: 0 })
  expect(await gateIsOpen(page)).toBe(false)
  await page.keyboard.down('KeyW')
  try {
    await gatePromptShown(page)
  } finally {
    await page.keyboard.up('KeyW')
  }
  await page.keyboard.press('KeyE', { delay: 100 })
  await expectOpenGate(page)
}

export { expectOpenGate, openGate }
