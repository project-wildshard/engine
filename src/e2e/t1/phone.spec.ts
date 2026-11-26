import {
  barStalls,
  SOFTWARE_GL_STALL_MS,
  STALL_MS,
  untracedChanges,
} from '../../scripts/loading-bar-rule.mjs'
import { readClones } from './clones.ts'
import { expect, phoneTest as test } from './fixtures.ts'
import { state } from './probe.ts'

import type { BarRow } from '../../scripts/loading-bar-rule.mjs'
import type { Page } from '@playwright/test'

interface Capture {
  readonly log: readonly BarRow[]
  readonly completedAt: number
  readonly serverFiles: boolean
}

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
  // The hosted runners' SwiftShader blocks on whole shader stages; see SOFTWARE_GL_STALL_MS (TR-4b).
  const renderer: unknown = await page.evaluate(`(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  })()`)
  const verdict = barStalls(
    capture.log,
    capture.log[0]?.t ?? 0,
    capture.completedAt,
    typeof renderer === 'string' && renderer.includes('SwiftShader')
      ? SOFTWARE_GL_STALL_MS
      : STALL_MS,
  )
  expect(verdict.stalls).toEqual([])
  expect(verdict.backwards).toEqual([])
  expect(untracedChanges(capture.log)).toEqual([])
})

// ENGINE-MEMORY EM25 (design rule 4): every worker message of 64 KB or more transfers its buffers, both ways.
test('the phone boot clones no worker buffer of 64 KB or more', async ({
  page,
}): Promise<void> => {
  const census = await readClones(page)
  expect(census.messages).toBeGreaterThan(0)
  expect(census.rows).toEqual([])
})

// ENGINE-MEMORY EM19 (design rule 5, a worker is a budgeted isolate): on the phone tier the decode workers retire 2 s after
// their last job (the far impostor decoder too), so a few seconds after control T1's page keeps at most the committed set:
// the standalone server, the neighbours' tile decoder and live JSON parser, held from loading to the page's end so no
// worker script is fetched in play (DL17, G872), and the region's road capture worker. A direct zone boot keeps only
// `serverWorker` (Template, Nine, Pine, Nalati, 2026-11-17; Brasscap since J434).
const PHONE_WORKERS_AT_CONTROL: readonly string[] = [
  'liveJsonParser.worker',
  'roadTileCapture.worker',
  'serverWorker',
  'tileDecodeWorker',
]
// A build hash is 8 base64url characters, so it can hold a '-' or '_' (run 44509093652's `serverWorker-Cmd9sw-J.js`).
const workerName = (url: string): string =>
  url
    .replace(/^.*\//u, '')
    .replace(/-[\w-]{8}\.js$/u, '')
    .replace(/^blob:.*/u, 'blob')
test('the phone keeps only its committed workers after control', async ({
  page,
}): Promise<void> => {
  await expect
    .poll(
      (): readonly string[] =>
        page
          .workers()
          .map((worker): string => workerName(worker.url()))
          .filter((name): boolean => !PHONE_WORKERS_AT_CONTROL.includes(name))
          .toSorted(),
      { timeout: 15_000 },
    )
    .toEqual([])
  expect(page.workers().length).toBeLessThanOrEqual(
    PHONE_WORKERS_AT_CONTROL.length,
  )
})

// ENGINE-MEMORY EM26 (design rule 7): the phone tier has one texture path, KTX2. Brasscap's phone boot uploads no shard
// texture as decoded RGBA8 over 1 MB (src/scripts/memory/uploadRecorder.mjs).
test('the phone boot uploads no shard texture as RGBA8 over 1 MB', async ({
  page,
}): Promise<void> => {
  const uploads = await page.evaluate(
    (): readonly object[] | undefined => globalThis.__imageUploads,
  )
  expect(uploads).toEqual([])
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
  // Boost pairs taps on a monotonic clock over 300 ms. Separate the gestures
  // in wall time so slow software rendering cannot stretch the gap.
  await page.waitForTimeout(350)
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
