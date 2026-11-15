import {
  barStalls,
  untracedChanges,
} from '../../../scripts/loading-bar-rule.mjs'
import { expect, test } from './fixtures.ts'
import { state } from './probe.ts'

import type { BarRow } from '../../../scripts/loading-bar-rule.mjs'
import type { Page } from '@playwright/test'

interface Capture {
  readonly log: readonly BarRow[]
  readonly completedAt: number
  readonly serverFiles: boolean
}

test.use({
  deviceProfile: 'phone',
  entryDelayMs: process.env['WS_T1_FAULT'] === 'loading-stall' ? 3000 : 0,
})

test('phone loading bars keep moving with original producer evidence', async ({
  page,
}): Promise<void> => {
  expect(page.viewportSize()).toEqual({ width: 402, height: 874 })
  const capture = await page.evaluate((): Capture => {
    const log = globalThis.__barLog
    const timing: unknown = Reflect.get(globalThis, '__bootTiming')
    if (
      log === undefined ||
      typeof timing !== 'object' ||
      timing === null ||
      !('entries' in timing) ||
      !Array.isArray(timing.entries)
    ) {
      throw new Error('Missing loading-card capture')
    }
    const completed: unknown = timing.entries.findLast(
      (row: unknown): boolean =>
        typeof row === 'object' &&
        row !== null &&
        'operation' in row &&
        row.operation === 'app:loader-complete',
    )
    if (
      typeof completed !== 'object' ||
      completed === null ||
      !('end' in completed) ||
      typeof completed.end !== 'number' ||
      !Number.isFinite(completed.end)
    ) {
      throw new Error('Missing real loader completion')
    }
    return {
      log,
      completedAt: completed.end,
      serverFiles:
        globalThis.__countLog?.some((row): boolean => row.serverFiles > 0) ??
        false,
    }
  })
  expect(capture.serverFiles).toBe(true)
  expect([...new Set(capture.log.map((row): string => row.bar))]).toEqual(
    expect.arrayContaining(['start', 'download', 'load']),
  )
  const verdict = barStalls(
    capture.log,
    capture.log[0]?.t ?? 0,
    capture.completedAt,
  )
  expect(verdict.stalls).toEqual([])
  expect(verdict.backwards).toEqual([])
  expect(untracedChanges(capture.log)).toEqual([])
})

async function mounted(page: Page): Promise<boolean> {
  return await page.evaluate((): boolean => {
    const world = globalThis.__wildshard?.world
    return (
      world?.player.hover === true &&
      world.player.hoverBlend > 0.5 &&
      world.weapons.tools.some(
        (tool): boolean =>
          tool.id === 'tool.hoverboard' &&
          tool.enabled &&
          tool.model?.visible === true,
      )
    )
  })
}

test('phone hover tab mounts the platform board and dismounts', async ({
  page,
}): Promise<void> => {
  const hover = page.locator('.ws-touch-hover')
  await expect(hover).toBeVisible()
  await hover.tap()
  await expect
    .poll(async (): Promise<boolean> => await mounted(page))
    .toBe(true)
  // Twenty drawn phone frames take at least 333 ms under its 60 fps
  // ceiling, separating gestures beyond the 300 ms boost window.
  const mountedFrame = await page.evaluate(
    (): number => globalThis.__wildshard?.world?.game.frameCount ?? 0,
  )
  await page.waitForFunction(
    (frame): boolean =>
      (globalThis.__wildshard?.world?.game.frameCount ?? 0) >= frame + 20,
    mountedFrame,
    { timeout: 5000 },
  )
  await hover.tap()
  await page.waitForFunction(
    (): boolean => globalThis.__wildshard?.world?.player.hover === false,
    undefined,
    { timeout: 5000 },
  )
})

test('phone joystick moves the seated player', async ({
  page,
}): Promise<void> => {
  const ring = await page.locator('.ws-touch-stick').boundingBox()
  if (ring === null) {
    throw new Error('Missing phone move stick')
  }
  const before = await state(page)
  const centerX = ring.x + ring.width / 2
  const centerY = ring.y + ring.height / 2
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: centerX, y: centerY, id: 1 }],
    })
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: centerX, y: centerY - 35, id: 1 }],
    })
    await page.waitForFunction(
      (origin): boolean => {
        const pos = globalThis.__wildshard?.state().player.pos
        return (
          pos !== undefined &&
          Math.hypot(pos.x - origin.x, pos.z - origin.z) > 0.75
        )
      },
      before.pos,
      { timeout: 5000 },
    )
  } finally {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await session.detach()
  }
})
