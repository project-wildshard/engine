import { readFileSync } from 'node:fs'

import { expect } from '@playwright/test'

import { FLOOR_GRID_ENTER } from '../../scripts/frame-floor-navigation.mjs'

import type { SmokeVec3 } from '../smoke/page-globals.d.ts'
import type { Page } from '@playwright/test'

interface State {
  readonly pos: SmokeVec3
  readonly health: number
  readonly slug: string
  readonly flags: readonly string[]
}

interface Poi {
  readonly id: string
  readonly x: number
  readonly z: number
}

interface Approach {
  readonly x?: number
  readonly z?: number
  readonly yaw?: number
}

/** The fixture serves the validated Brasscap pin at the origin cell. */
function pinnedPoi(id: string): Poi {
  const data: unknown = JSON.parse(
    readFileSync(
      new URL(
        '../../../out/brasscap-mesa/sections/ui/level.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  if (typeof data !== 'object' || data === null || !('manifest' in data)) {
    throw new TypeError('Missing pinned Brasscap manifest')
  }
  const { manifest } = data
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('pois' in manifest) ||
    !Array.isArray(manifest.pois)
  ) {
    throw new TypeError('Missing pinned Brasscap POIs')
  }
  const row: unknown = manifest.pois.find(
    (value: unknown): boolean =>
      typeof value === 'object' &&
      value !== null &&
      'id' in value &&
      value.id === id,
  )
  if (
    typeof row !== 'object' ||
    row === null ||
    !('x' in row) ||
    !('z' in row) ||
    typeof row.x !== 'number' ||
    typeof row.z !== 'number' ||
    !Number.isFinite(row.x) ||
    !Number.isFinite(row.z)
  ) {
    throw new TypeError(`Unknown or invalid Brasscap POI: ${id}`)
  }
  return { id, x: row.x, z: row.z }
}

/** TR-4b: each inPlay wait's end, in seconds of the entered document, for the `[t1-boot]` line (`fixtures.ts`). */
const playMarks = new WeakMap<Page, string[]>()

async function markPlay(page: Page, name: string): Promise<void> {
  const at = await page
    .evaluate((): number => performance.now())
    .catch((): number => Number.NaN)
  const marks = playMarks.get(page) ?? []
  marks.push(`${name}@${(at / 1000).toFixed(1)}`)
  playMarks.set(page, marks)
}

/** The page's frame rate and its frames' p95 main-thread cost as the worker client counts them: on software GL the
 *  waits after control are page frames (TR-4b). */
async function markRate(page: Page): Promise<void> {
  const rate = await page
    .evaluate((): string => {
      const report = globalThis.__workerClient?.()
      return report === undefined
        ? 'rate unread'
        : `${report.framesPerSecond.toFixed(1)} fps, p95 ${report.mainMsP95.toFixed(0)} ms`
    })
    .catch((): string => 'rate unread')
  const marks = playMarks.get(page) ?? []
  marks.push(rate)
  playMarks.set(page, marks)
}

/** The marks the last inPlay left on this page, once. */
function takePlayMarks(page: Page): readonly string[] {
  const marks = playMarks.get(page) ?? []
  playMarks.delete(page)
  return marks
}

async function inPlay(page: Page): Promise<void> {
  playMarks.delete(page)
  await page.bringToFront()
  // A level the page retires while this polls (a same-page re-entry, a healed 503) throws from the probe until the next
  // level installs its own: that read is "not in play yet", never the end of the wait.
  await page.waitForFunction((): boolean => {
    try {
      const probe = globalThis.__wildshard
      return (
        (probe?.app.state === 'play' || probe?.app.state === 'paused') &&
        probe.area()?.slug === 'brasscap-mesa' &&
        (probe.area()?.targets.length ?? 0) > 0 &&
        (probe.world?.game.frameCount ?? 0) > 5
      )
    } catch {
      return false
    }
  })
  await markPlay(page, 'frames')
  const resume = page.locator('.ws-gmenu.show:not([inert]) .ws-gmenu-close')
  if (await resume.isVisible()) {
    await resume.click()
  }
  await page.waitForFunction((): boolean => {
    try {
      return globalThis.__wildshard?.app.state === 'play'
    } catch {
      return false
    }
  })
  await markPlay(page, 'play')
  const address = new URL(page.url())
  address.searchParams.set('fps', '30')
  await page.evaluate((href): void => {
    globalThis.history.replaceState(globalThis.history.state, '', href)
  }, address.href)
  await page.evaluate(FLOOR_GRID_ENTER)
  await page.waitForFunction(
    (): boolean => (globalThis.__workerClient?.().frames ?? 0) > 30,
  )
  await markPlay(page, 'worker')
  await markRate(page)
  await expect(page.locator('#hud.intro,.ws-reveal')).toHaveCount(0, {
    timeout: 10_000,
  })
  await markPlay(page, 'revealed')
}

async function state(page: Page): Promise<State> {
  return await page.evaluate((): State => {
    const probe = globalThis.__wildshard
    const area = probe?.area()
    if (probe === undefined || area?.slug !== 'brasscap-mesa') {
      throw new Error('Brasscap is not seated')
    }
    const { player } = probe.state()
    return {
      pos: player.pos,
      health: player.health,
      slug: area.slug,
      flags: area.flags,
    }
  })
}

/** Move with the game's harness control, including its server placement message. */
async function poseAt(
  page: Page,
  id: string,
  approach: Approach = {},
): Promise<Poi> {
  await inPlay(page)
  const origin = pinnedPoi(id)
  const poi: Poi & Approach = {
    ...origin,
    x: origin.x + (approach.x ?? 0),
    z: origin.z + (approach.z ?? 0),
    ...(approach.yaw === undefined ? {} : { yaw: approach.yaw }),
  }
  await page.evaluate(async (pose): Promise<void> => {
    const probe = globalThis.__wildshard
    if (probe === undefined) {
      throw new Error('Missing game probe')
    }
    await probe.pose(pose)
  }, poi)
  await page.waitForFunction(({ x, z }): boolean => {
    const pos = globalThis.__wildshard?.state().player.pos
    return pos !== undefined && Math.hypot(pos.x - x, pos.z - z) < 0.2
  }, poi)
  return poi
}

export { inPlay, poseAt, state, takePlayMarks }
export type { State }
