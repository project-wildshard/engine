// MEMORY-STRUCTURE STR2, STR3 (J414, J419): `pnpm dev`'s page plays on the local Node game server (src/scripts/dev-world.mjs),
// never on the in-page server worker; its saves are on disk, and a server restart leaves the open page in play.
import { rmSync } from 'node:fs'

import { Client } from 'pg'

import { devices } from '../../scripts/browser-playwright.mjs'
import { expect, test as base } from '../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../scripts/debug-settings.mjs'
import { openDevWorld } from '../../scripts/dev-world.mjs'
import { enterBrasscap } from './fixtures.ts'
import { oldLinkIsTitle } from './old-link.ts'

import type { DevWorld } from '../../scripts/dev-world.mjs'

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
        shard: 'brasscap-mesa',
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

/** STR4: a control on the dev server's channel, as a loopback tool sends it. */
async function control(
  world: DevWorld,
  body?: object,
): Promise<{ readonly status: number; readonly answer: unknown }> {
  const url = `${world.socket.replace('ws:', 'http:')}__dev/control`
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
  )
  return {
    status: response.status,
    answer: await response.json().catch((): undefined => undefined),
  }
}

/** The devices the dev server seats now. */
async function seatsOf(world: DevWorld): Promise<readonly string[]> {
  const { answer } = await control(world)
  return typeof answer === 'object' &&
    answer !== null &&
    'seats' in answer &&
    Array.isArray(answer.seats)
    ? answer.seats.map(String)
    : []
}

test('the dev page plays on the local Node server, a restart keeps its save and its page, the harness verbs reach it', async ({
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
    await enterBrasscap(page, 'Dev Alice')
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

    // STR3: the world goes down (saves written to disk) and comes back; the page redials and is in play within 10 s of
    // the world going down (its server bundle rebuilds before that, while the world still runs)
    const started = await dev.restart()
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

    // STR4: the harness verbs reach the dev server for the seated page. The same page as above, not a second boot: a
    // hosted software-GL boot is about a minute, and two of them with the dev world's start overran J's 120 s (TR-4b)
    const seats = await seatsOf(dev)
    expect(seats).toHaveLength(1)
    const device = seats[0] ?? ''
    const refused = await control(dev, { device: 'nobody', flag: 'x' })
    expect(refused.status).toBe(409)
    const verbs: readonly Readonly<Record<string, unknown>>[] = [
      { flag: 'dev-proof' },
      { hits: 2 },
      { god: true },
      { still: true },
      { probe: true },
    ]
    const answers = await Promise.all(
      verbs.map(
        async (verb: Readonly<Record<string, unknown>>): Promise<unknown> => {
          const { answer } = await control(dev, { device, ...verb })
          return answer
        },
      ),
    )
    for (const answer of answers) {
      expect(answer).toMatchObject({ ok: true })
    }
    // A place moves the body on the server, and the page's player snaps to it
    const at = await page.evaluate((): { x: number; y: number; z: number } => {
      const pos = globalThis.__wildshard?.state().player.pos
      return { x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0 }
    })
    const placed = await control(dev, {
      device,
      x: at.x + 6,
      y: at.y + 1,
      z: at.z,
      yaw: 0,
    })
    expect(placed.answer).toMatchObject({ ok: true })
    await expect
      .poll(
        async (): Promise<number> =>
          await page.evaluate(
            (): number => globalThis.__wildshard?.state().player.pos.x ?? 0,
          ),
        { timeout: 5000 },
      )
      .toBeGreaterThan(at.x + 4)
  } finally {
    await context.close()
  }
})

test('CP22: an old chunk link to the dev world is its title and takes no seat', async ({
  browser,
  dev,
}): Promise<void> => {
  // The first test's page has closed: its seat goes first
  await expect
    .poll(async (): Promise<number> => await seated(dev), { timeout: 30_000 })
    .toBe(0)
  await oldLinkIsTitle(browser, dev.url)
  expect(await seated(dev), 'no seat taken').toBe(0)
})
