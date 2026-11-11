// T2E-2 (TEMPLATE-E2E-PLAN, J233): the Template 2 smoke. One page, one reload, through the real title.
// The client comes from scripts/e2e-client.mjs: Template 2 from the @wildshard/format dependency, a warm watcher's
// build, no network and no cook. Each stretch's wall time goes to tmp/e2e/receipt.json (TB-4).
import { mkdirSync, writeFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import {
  ROOT,
  doorOpens,
  earned,
  enter,
  hideAndSave,
  readyClient,
  snapshot,
  stopClient,
  walkTo,
} from './game.ts'

/** The plan's budget for the whole smoke, client included (J233). Report-only until T2E-4 makes it block. */
const BUDGET_MS = 60_000
/** The one off-machine host the real title asks for: the draft cards' thumbnails (src/client/game/draftTitles.ts). */
const DRAFT_THUMBS = '64yencbq8tncsy39.public.blob.vercel-storage.com'
/** A transparent 1×1 PNG. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
/** Template 2's hall (shardfile corpus/handwritten): the door at z = 15.6, the guardian's 4 m region at z = 32. Steps 4
 * (a pickup) and 5 (a fight) wait for Template 2 content: shardfile rows S2-1 and S2-2. */
const BEFORE_DOOR_Z = 13.8
const GUARDIAN_Z = 28.5

const split: Record<string, number> = {}
let mark = performance.now()
function lap(name: string): void {
  const now = performance.now()
  split[name] = Math.round(now - mark)
  mark = now
}

test.afterAll((): void => {
  // A hosted job ends here: its watcher would hold a build lease until it idles out.
  if (process.env['CI'] !== undefined) {
    stopClient()
  }
})

test('Template 2: title, walk, door, guardian, reload', async ({
  page,
}): Promise<void> => {
  test.setTimeout(5 * 60_000)
  const started = performance.now()
  mark = started
  const client = readyClient()
  lap('client')
  const errors: string[] = []
  page.on('pageerror', (error: Readonly<Error>): void => {
    errors.push(error.message)
  })
  page.on('console', (message): void => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  // Nothing leaves the machine (T2E-1): the draft thumbnails get an empty image, and any other host fails the smoke.
  await page.route(
    (url: Readonly<URL>): boolean =>
      url.protocol.startsWith('http') && url.hostname !== '127.0.0.1',
    async (route): Promise<void> => {
      const request = route.request()
      const { hostname, pathname } = new URL(request.url())
      if (
        hostname !== DRAFT_THUMBS ||
        request.resourceType() !== 'image' ||
        !pathname.startsWith('/draft/')
      ) {
        errors.push(
          `left the machine: ${request.method()} ${hostname}${pathname}`,
        )
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: PIXEL,
      })
    },
  )

  await test.step('1. the real title to play', async (): Promise<void> => {
    await page.goto(client.origin)
    await enter(page)
    lap('title')
  })

  await test.step('2. walk to the door and jump', async (): Promise<void> => {
    const spawn = await snapshot(page)
    expect(spawn.door).toBe(0)
    expect(spawn.solid).toBe(true)
    await walkTo(page, BEFORE_DOOR_Z, spawn)
    lap('walk')
  })

  await test.step('3. E opens the door', async (): Promise<void> => {
    await page.keyboard.press('KeyE')
    await doorOpens(page)
    await earned(page, 'blender.door')
    const open = await snapshot(page)
    expect(open.door).toBe(1)
    expect(open.solid).toBe(false)
    lap('door')
  })

  await test.step('6. reach the guardian; the quest completes', async (): Promise<void> => {
    await walkTo(page, GUARDIAN_Z)
    await earned(page, 'blender.complete')
    lap('guardian')
  })

  await test.step('7. reload: the door stays open, the quest stays done', async (): Promise<void> => {
    await hideAndSave(page)
    await page.reload()
    await enter(page)
    const back = await snapshot(page)
    expect(back.door).toBe(1)
    expect(back.solid).toBe(false)
    expect(back.flags).toEqual(
      expect.arrayContaining([
        'blender.door',
        'blender.guardian',
        'blender.complete',
      ]),
    )
    lap('reload')
  })

  expect(errors).toEqual([])
  const wallMs = Math.round(performance.now() - started)
  const receipt = {
    at: new Date().toISOString(),
    wallMs,
    budgetMs: BUDGET_MS,
    over: wallMs > BUDGET_MS,
    warm: client.warm,
    split,
  }
  mkdirSync(`${ROOT}tmp/e2e`, { recursive: true })
  writeFileSync(`${ROOT}tmp/e2e/receipt.json`, `${JSON.stringify(receipt)}\n`)
  process.stdout.write(
    `template 2 smoke: ${String(wallMs)} ms of ${String(BUDGET_MS)}, ${JSON.stringify(split)}\n`,
  )
})
