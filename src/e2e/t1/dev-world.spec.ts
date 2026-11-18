// MEMORY-STRUCTURE STR2, STR3 (J414, J419): `pnpm dev`'s page plays on the local Node game server (scripts/dev-world.mjs),
// never on the in-page server worker; its saves are on disk, and a server restart leaves the open page in play.
import { rmSync } from 'node:fs'

import { Client } from 'pg'

import { devices } from '../../../scripts/browser-playwright.mjs'
import { expect, test as base } from '../../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../../scripts/debug-settings.mjs'
import { openDevWorld } from '../../../scripts/dev-world.mjs'
import { enterTemplate } from './fixtures.ts'

import type { DevWorld } from '../../../scripts/dev-world.mjs'

const test = base.extend<object, { readonly dev: DevWorld }>({
  dev: [
    async ({ browserName }, provide): Promise<void> => {
      expect(browserName).toBe('chromium')
      const dist = process.env['WS_T1_BUILD_DIR']
      if (dist === undefined) {
        throw new Error('Missing shared client build')
      }
      const work = `tmp/${process.env['WS_LANE_NAME'] ?? 't1-e2e'}/t1/dev-world`
      rmSync(work, { recursive: true, force: true })
      const world = await openDevWorld({
        dist,
        work,
        port: 0,
        log: (): void => undefined,
      })
      try {
        await provide(world)
      } finally {
        await world.close()
        rmSync(work, { recursive: true, force: true })
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
})

/** Rows in the dev world's save table, read over its own loopback database. */
async function saveRows(world: DevWorld): Promise<number> {
  const client = new Client({ connectionString: world.database })
  await client.connect()
  try {
    const result = await client.query<{ rows: string }>(
      'select count(*) as rows from player_save',
    )
    return Number(result.rows[0]?.rows ?? 0)
  } finally {
    await client.end()
  }
}

/** Players seated in the dev world now (its `/health`), or -1 while it is down. */
async function seated(world: DevWorld): Promise<number> {
  const health = await fetch(
    `${world.socket.replace('ws:', 'http:')}health`,
  ).catch((): undefined => undefined)
  if (health?.ok !== true) {
    return -1
  }
  const body: unknown = await health.json()
  return typeof body === 'object' &&
    body !== null &&
    'players' in body &&
    typeof body.players === 'number'
    ? body.players
    : -1
}

test('the dev page plays on the local Node server, a restart keeps its save and its page', async ({
  browser,
  dev,
}): Promise<void> => {
  const context = await browser.newContext({ ...devices['Desktop Chrome'] })
  try {
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await saveFixture(context, {
      scope: 'device',
      key: 'firstPlayDone',
      data: true,
    })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    const workers: string[] = []
    page.on('worker', (worker): void => {
      workers.push(new URL(worker.url()).pathname)
    })
    // No init script: the dev port stamps the document itself.
    await page.goto(`${dev.url}?mute=1&nolock=1&fps=30`)
    await enterTemplate(page, 'Dev Alice')
    expect(
      await page.evaluate(
        (): boolean => Reflect.get(globalThis, '__WS_WORLD__') !== undefined,
      ),
    ).toBe(true)
    expect(
      workers.filter((path): boolean => /serverWorker/u.test(path)),
      'no in-page server worker',
    ).toEqual([])
    expect(await seated(dev)).toBe(1)

    // STR3: the world goes down (saves written to disk) and comes back; the page redials and is in play within 10 s
    const started = Date.now()
    await dev.restart()
    expect(
      await saveRows(dev),
      'the drain wrote the player to disk',
    ).toBeGreaterThan(0)
    await expect
      .poll(async (): Promise<number> => await seated(dev), {
        timeout: Math.max(1, 10_000 - (Date.now() - started)),
      })
      .toBe(1)
    expect(
      await page.evaluate(
        (): string | undefined => globalThis.__wildshard?.app.state,
      ),
    ).toBe('play')
    expect(
      workers.filter((path): boolean => /serverWorker/u.test(path)),
    ).toEqual([])
  } finally {
    await context.close()
  }
})
