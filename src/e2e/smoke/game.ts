// The page reads and player moves the Template 2 smoke uses. Page globals are typed in page-globals.d.ts.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { expect } from '@playwright/test'

import type { Page } from '@playwright/test'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
/** Each in-world wait fails on its own within this, so a planted fault names its step, not the test's timeout. */
const STEP = { timeout: 30_000 }

interface Snapshot {
  readonly pos: Readonly<Record<'x' | 'y' | 'z', number>>
  readonly door: number | undefined
  readonly solid: boolean
  readonly flags: readonly string[]
}

interface Client {
  readonly origin: string
  readonly warm: boolean
}

function isClient(value: unknown): value is Client {
  return (
    typeof value === 'object' &&
    value !== null &&
    'origin' in value &&
    typeof value.origin === 'string' &&
    'warm' in value &&
    typeof value.warm === 'boolean'
  )
}

function client(command: 'ready' | 'stop'): string {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      './scripts/format-hook.mjs',
      'scripts/e2e-client.mjs',
      command,
    ],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (run.status !== 0) {
    throw new Error(
      `e2e-client ${command} failed\n${run.stdout}\n${run.stderr}`,
    )
  }
  return run.stdout.trim().split('\n').at(-1) ?? ''
}

/** The scripts/e2e-client.mjs client: Template 2 from the format dependency and a warm watcher's settled build. */
function readyClient(): Client {
  const answer: unknown = JSON.parse(client('ready'))
  if (!isClient(answer)) {
    throw new Error('e2e-client gave no origin')
  }
  return answer
}

/** Stops this worktree's watcher, which frees its build lease. */
function stopClient(): void {
  client('stop')
}

/** The facts each step reads, from the page's own probe and worker rows. */
async function snapshot(page: Page): Promise<Snapshot> {
  return await page.evaluate((): Snapshot => {
    const probe = globalThis.__wildshard
    if (probe === undefined) {
      throw new Error('no game probe')
    }
    const state = probe.state()
    return {
      pos: state.player.pos,
      door: globalThis.__workerClientRow?.('blender.door.open'),
      solid:
        probe.shard.shardfile
          ?.targets()
          .some((target): boolean => target.solid) ?? false,
      flags: state.quest.adventure?.quest ?? [],
    }
  })
}

/** Title, Shard Select, Blender Template, Enter: the way a player starts (J233). */
async function enter(page: Page): Promise<void> {
  await page.locator('.ws-main-select').waitFor()
  // Blender Template is a Developer shard. The switch is remembered across a reload.
  const developer = page.locator('.ws-main-dev')
  if ((await developer.getAttribute('aria-checked')) !== 'true') {
    await developer.click()
  }
  await expect(developer).toHaveAttribute('aria-checked', 'true')
  await page.locator('.ws-main-select').click()
  const cards = await page.locator('.ws-menu-card b').allTextContents()
  const index = cards.indexOf('Blender Template')
  expect(
    index,
    `Shard Select lists ${cards.join(', ')}`,
  ).toBeGreaterThanOrEqual(0)
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).click()
  await page
    .locator(`.ws-menu-card.selected[data-i="${String(index)}"]`)
    .waitFor()
  await page.locator('.ws-menu-play').click()
  await page.waitForFunction((): boolean => {
    const probe = globalThis.__wildshard
    return (
      probe?.shard.slug === 'blender-template' &&
      probe.app.state === 'play' &&
      (probe.world?.game.frameCount ?? 0) > 5
    )
  })
}

/** Resolves once the player's position passes `past` on one axis. */
async function reach(page: Page, axis: 'y' | 'z', past: number): Promise<void> {
  await page.waitForFunction(
    ([key, value]): boolean =>
      (globalThis.__wildshard?.state().player.pos[key] ?? 0) > value,
    [axis, past] as const,
    STEP,
  )
}

/** Hold W until the player is past `toZ`, jumping once on the way when given where the walk starts. */
async function walkTo(
  page: Page,
  toZ: number,
  jumpFrom?: Snapshot,
): Promise<void> {
  await page.keyboard.down('KeyW')
  try {
    if (jumpFrom !== undefined) {
      await reach(page, 'z', jumpFrom.pos.z + 0.5)
      await page.keyboard.press('Space')
      await reach(page, 'y', jumpFrom.pos.y + 0.25)
    }
    await reach(page, 'z', toZ)
  } finally {
    await page.keyboard.up('KeyW')
  }
}

/** Resolves once the door's row reads open and its panel no longer blocks. */
async function doorOpens(page: Page): Promise<void> {
  await page.waitForFunction(
    (): boolean =>
      globalThis.__workerClientRow?.('blender.door.open') === 1 &&
      globalThis.__wildshard?.shard.shardfile
        ?.targets()
        .every((target): boolean => !target.solid) === true,
    undefined,
    STEP,
  )
}

/** Resolves once the quest flag is earned. */
async function earned(page: Page, flag: string): Promise<void> {
  await page.waitForFunction(
    (name): boolean =>
      globalThis.__wildshard?.state().quest.adventure?.quest?.includes(name) ===
      true,
    flag,
    STEP,
  )
}

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

export type { Client, Snapshot }
export {
  ROOT,
  doorOpens,
  earned,
  enter,
  hideAndSave,
  reach,
  readyClient,
  snapshot,
  stopClient,
  walkTo,
}
