// The phone journey judge T1's E and F suites share (journey.spec.ts, journey-ways.spec.ts): BUGBASH-LOOP's tapped path
// from the title into play, where every sample is a menu, the world's full-screen loading card or play.
import { expect } from '../../scripts/browser-test.mjs'
import { harnessPins, saveFixture } from '../../scripts/debug-settings.mjs'
import {
  judge,
  label,
  PHONE,
  stickMoves,
  tapJourney,
} from '../../scripts/journey-proof.mjs'

import type { JourneyPath, Sample } from '../../scripts/journey-proof.mjs'
import type { Browser, Frame, Locator, Page, WebSocket } from '@playwright/test'

// MAIN-SCREEN MS5 (J399): the same judge on all three ways in: ZONE SELECT and a card, ENTER THE MMO, and the one-zone deep
// link; each must reach the zone's detailed full-screen loading card and play.
async function journey(
  page: Page,
  run: string,
  way: JourneyPath = 'select',
): Promise<void> {
  await page.goto(
    way === 'deeplink'
      ? '/slug/brasscap-mesa?mute=1&nolock=1'
      : '/?mute=1&nolock=1',
  )
  const samples = await tapJourney(page, { card: 'brasscap-mesa', path: way })
  const path = samples.map(
    (row: Sample): string => `${String(row.t)}:${label(row.s)}`,
  )
  expect(judge(samples), `${run}: ${path.join(' ')}`).toEqual([])
  expect(await stickMoves(page), `${run}: the stick moves the player`).toBe(
    true,
  )
  await page.goto('about:blank')
}

/** Run `ways` (journeys, in order) on one phone page, as a player taps them; the page raises no error throughout. */
async function phoneJourneys(
  browser: Browser,
  baseURL: string | undefined,
  ways: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    ...(baseURL === undefined ? {} : { baseURL }),
  })
  try {
    // Brasscap is a Developer card; Developer changes no screen on this path
    await saveFixture(context, { scope: 'device', key: 'devMode', data: true })
    await harnessPins(context, { seed: 357 })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error: Readonly<Error>): void => {
      errors.push(error.message)
    })
    await ways(page)
    expect(errors).toEqual([])
  } finally {
    await context.close()
  }
}

async function markedZoneSelectPress(
  browser: Browser,
  baseURL: string | undefined,
): Promise<void> {
  if (baseURL === undefined) {
    throw new Error('The T1 preview needs a base URL')
  }
  const origin = 'https://staging.wildshard.io'
  const rooms = 'https://rooms-staging.wildshard.io'
  const context = await browser.newContext({
    ...PHONE,
    isMobile: true,
    serviceWorkers: 'block',
  })
  try {
    await context.addInitScript((): void => {
      Reflect.set(globalThis, '__WS_WORLD__', {
        release: '/zone-select-test-release.json',
        key: 'fixture',
      })
    })
    // The real preview title uses staging's origin here. Both its assets and the door are owned fixtures.
    await context.route(`${origin}/**`, async (route): Promise<void> => {
      const { pathname, search } = new URL(route.request().url())
      if (pathname.endsWith('/standalone/online.js')) {
        await route.fulfill({
          contentType: 'text/javascript',
          body: `
          export const zoneSelectLocation = async () => ({ url: "${rooms}/zone-select", channel: "staging" });
          export const worldWord = async () => null;
          export const titleEnter = async (_, go) => go();
        `,
        })
        return
      }
      const reply = await route.fetch({
        url: new URL(pathname + search, baseURL).href,
      })
      await route.fulfill({ response: reply })
    })
    let count = 0
    await context.route(`${rooms}/**`, async (route): Promise<void> => {
      const post = route.request().method() === 'POST'
      if (post) {
        count += 1
      }
      await route.fulfill({
        status: post ? 204 : 503,
        headers: { 'access-control-allow-origin': origin },
      })
    })
    const page = await context.newPage()
    await page.goto(`${origin}/?agent=zone-select-t1&mute=1&nolock=1`)
    await page.locator('.ws-main-select').tap()
    await page
      .locator('#ws-name-box, .ws-title-stack[data-screen="select"]')
      .first()
      .waitFor({ timeout: 15_000 })
    const skip = page.locator('#ws-name-box [data-name=skip]')
    if (await skip.isVisible()) {
      await skip.tap()
    }
    const card = page.locator('.ws-menu-card.selected')
    const slug = await card.getAttribute('data-slug')
    const sent = page.waitForRequest(
      (req): boolean =>
        req.method() === 'POST' &&
        req.url().startsWith(`${rooms}/zone-select/enter?`),
    )
    await page.locator('.ws-menu-play').tap()
    const press = await sent
    expect(new URL(press.url()).searchParams.get('agent')).toBe(
      'zone-select-t1',
    )
    expect(press.postDataJSON()).toEqual({
      slug,
      channel: 'staging',
      audience: 'automation',
    })
    expect(press.headers()['x-wildshard-agent']).toBeUndefined()
    await expect.poll((): number => count).toBe(1)
  } finally {
    await context.close()
  }
}

// CHUNK-PARAM CP9 (J522): the tap names the zone in the tab, never the address. The page-side code is a string: this
// build has no DOM types.
/** An init script: copies the tap record each document starts with (the save blob's `titleArrival` or its device copy)
 *  to `globalThis.__wsStartTap`, before the boot claims it. */
const startTapScript = `(() => {
  const taps = [];
  const read = (store) => {
    for (const name of Object.keys(store)) {
      if (!name.startsWith('wildshard.save')) continue;
      const keys = JSON.parse(store.getItem(name) || '{}').keys || {};
      for (const key of ['titleArrival', 'titleArrival.once']) {
        const data = keys[key] && keys[key].data;
        if (data !== undefined && data !== null) taps.push(JSON.stringify(data));
      }
    }
  };
  try { read(sessionStorage); read(localStorage); } catch { /* blocked storage: the wait names it */ }
  globalThis.__wsStartTap = taps.join(' ');
})()`

/** Taps `play` and waits for the new document at `/` that started with a tap naming `zone`; its address names none. */
async function tapIntoZone(
  page: Page,
  play: Locator,
  zone: string,
): Promise<void> {
  const was = await page.evaluate<number>('performance.timeOrigin')
  await play.tap({ timeout: 5000 })
  await page.waitForFunction(
    `performance.timeOrigin !== ${String(was)} && location.pathname === '/' && String(globalThis.__wsStartTap ?? '').includes(${JSON.stringify(zone)})`,
    undefined,
    { timeout: 30_000 },
  )
  expect(new URL(page.url()).searchParams.has('chunk')).toBe(false)
}

/** Every main-frame navigation and socket URL on `page` that names a zone (`chunk=`), as it happens. */
function zoneAddresses(page: Page): readonly string[] {
  const named: string[] = []
  const watch = (url: string): void => {
    if (/[?&]chunk=/u.test(url)) {
      named.push(url)
    }
  }
  page.on('framenavigated', (frame: Readonly<Frame>): void => {
    if (frame === page.mainFrame()) {
      watch(frame.url())
    }
  })
  page.on('websocket', (socket: Readonly<WebSocket>): void => {
    watch(socket.url())
  })
  return named
}

export {
  journey,
  markedZoneSelectPress,
  phoneJourneys,
  startTapScript,
  tapIntoZone,
  zoneAddresses,
}
