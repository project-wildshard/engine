#!/usr/bin/env node
// Manual LS2-LS6 proof on real boots. Deliberately outside hooks and the unit-test glob.
// Run through src/scripts/browser-lane.sh after `pnpm build:ring`:
//   src/scripts/browser-lane.sh node src/scripts/loading-card-proof.mjs [--shard=template] [--out=<dir>] [--throttle] [--gpu] [--grid]
// --gpu (J204): Chromium on this Mac's real GPU (ANGLE Metal) instead of headless SwiftShader; --throttle still slows its CPU 4x.
// It boots the built product at iPhone portrait size in Chromium and WebKit, records every change of the
// card's bars with the LS1 counters that moved with it, screenshots the card loading and ready, and reports
// each stretch of over 2 s where the bar took less than 1 %, by the stage that held it.
import { enterZone } from './zone-entry.mjs'
import { agentFetch as fetch } from './agent-requests.mjs';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { resolve as resolvePath, join } from 'node:path'

import { chromium, webkit, devices } from "./browser-playwright.mjs"

import { KEYCHAIN_ARGS } from './.kit/chromium-keychain.mjs'
import { saveFixture, debugSettings } from './debug-settings.mjs'
import { barStalls, untracedChanges } from './loading-bar-rule.mjs'
import { recordBars } from './loading-card-recorder.mjs'
import { serve } from './parity/serve.mjs'
import {
  walk as walkGrid,
  entered,
  settled,
  observed,
} from './worker-client-grid-entry.mjs'

/** @param {string} name */
const option = name =>
  process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
const root = resolvePath(option('root') ?? '.'),
  shard = option('shard') ?? 'brasscap-mesa'
const out = resolvePath(option('out') ?? 'tmp/loading-card'),
  throttle = process.argv.includes('--throttle'),
  gpu = process.argv.includes('--gpu')
const chromiumArgs = [
  ...KEYCHAIN_ARGS,
  '--mute-audio',
  ...(gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : []),
]
const only = option('browser')
const grid = process.argv.includes('--grid')
if (option('arrival') !== undefined)
  throw new Error('Seeded titleArrival is not a saved-place proof; use --grid')
mkdirSync(out, { recursive: true })

const remote = option('base')
if (remote !== undefined && remote !== 'https://play.wildshard.io')
  throw new Error('Remote proof requires the real production origin')
if (remote !== undefined) {
  const response = await fetch(`${remote}/version.json`, { cache: 'no-store' }),
    version = await response.json()
  if (
    !response.ok ||
    version.build !== option('expect-build-id') ||
    version.saveEpoch !== 2
  )
    throw new Error('Unexpected production build or save epoch')
  console.log('Exact production loading proof', JSON.stringify(version))
}
const html =
  remote === undefined
    ? readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    : await (await fetch(remote, { cache: 'no-store' })).text()
const title = /id="ws-title-rows"[^>]*>(.*?)<\/script>/su.exec(html)?.[1]
if (title === undefined) throw new Error('Built title catalogue is absent')
const installed = /** @type {{slug:string}[]} */ (JSON.parse(title))
for (const requested of grid
  ? ['driftwood-isle', 'open-plot-ember-forge']
  : [shard])
  if (!installed.some(row => row.slug === requested))
    throw new Error(
      `Built catalogue lacks ${requested}; use its exact slug/full build`,
    )
const preview =
  remote === undefined
    ? await serve(root, '', true)
    : { url: remote, close: () => undefined }
const report = []
try {
  for (const name of ['chromium', 'webkit']) {
    if (only !== undefined && only !== name) continue
    const engine = name === 'chromium' ? chromium : webkit
    const profile = grid ? mkdtempSync(join(out, `${name}-profile-`)) : null
    const browser = grid
      ? null
      : await engine.launch({
          headless: true,
          ...(name === 'chromium' ? { args: chromiumArgs } : {}),
        })
    try {
      const context =
        profile !== null
          ? await engine.launchPersistentContext(profile, {
              ...devices['iPhone 16 Pro'],
              deviceScaleFactor: 2,
              headless: true,
              ...(name === 'chromium' ? { args: chromiumArgs } : {}),
            })
          : await browser?.newContext({
              ...devices['iPhone 16 Pro'],
              deviceScaleFactor: 2,
            })
      if (context === undefined) throw new Error('Proof context not created')
      try {
        await context.grantPermissions(
          name === 'chromium'
            ? ['clipboard-read', 'clipboard-write']
            : ['clipboard-read'],
        )
        await saveFixture(context, {
          scope: 'device',
          key: 'devMode',
          data: true,
        })
        await debugSettings(context, { holdLoading: true })
        await context.addInitScript(recordBars)
        const page = await context.newPage()
        /** @type {string[]} */ const faults = []
        // each grid entry reports the faults raised from the end of the previous entry (its Exit) through its own Exit;
        // the page, and so its error listener, spans all three
        let faultCursor = 0
        page.on('pageerror', error => faults.push(error.message))
        if (throttle && name === 'chromium') {
          const cdp = await context.newCDPSession(page)
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
          await cdp.send('Network.enable')
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: 150,
            downloadThroughput: (1.6e6 / 8) * 8,
            uploadThroughput: 750e3 / 8,
          })
        }
        /** @type {{x:number,z:number}|null} */ let earnedPose = null
        // Arm the metadata fault before the preceding real Exit navigation.
        // Re-loading an already-active title adds an unrelated WebKit native
        // cancellation path; neither arrival nor progress is part of this fault.
        const omitEmberArt = async () => {
          await context.route('**/*', async route => {
            if (!route.request().isNavigationRequest()) {
              await route.continue()
              return
            }
            const response = await route.fetch(),
              body = await response.text()
            const changed = body.replace(
              /(id="ws-title-rows"[^>]*>)(.*?)(<\/script>)/su,
              (_all, head, json, tail) => {
                const rows = JSON.parse(json)
                for (const row of rows)
                  if (row.slug === 'open-plot-ember-forge')
                    row.card.portrait = ''
                return head + JSON.stringify(rows) + tail
              },
            )
            await route.fulfill({ response, body: changed })
          })
          // The fault targets the network document, not an older embedded SW
          // DOCUMENT. Keep the earned durable save and all immutable bytes.
          await page.evaluate(async () => {
            for (const registration of await navigator.serviceWorker.getRegistrations())
              await registration.unregister()
          })
        }
        if (grid)
          await page.goto(`${preview.url}/?mute=1&nolock=1&sw=0`, {
            waitUntil: 'domcontentloaded',
          })
        for (const attempt of grid
          ? ['fresh-grid', 'saved-ember', 'missing-art']
          : ['entry']) {
          const tag = `${name}${gpu && name === 'chromium' ? '-gpu' : ''}${throttle && name === 'chromium' ? '-throttled' : ''}-${grid ? attempt : shard}`
          /** @type {{name:string,art:string}|null} */ let destination = null
          if (grid) {
            await page.locator('.ws-main-grid').waitFor({ timeout: 60000 })
            destination = await page.evaluate(
              slug => {
                const rows = JSON.parse(
                  document.getElementById('ws-title-rows')?.textContent ?? '[]',
                )
                const row = rows.find(
                  (/** @type {{slug:string}} */ candidate) =>
                    candidate.slug === slug,
                )
                if (row === undefined)
                  throw new Error('Full catalogue destination absent')
                return { name: row.name, art: row.card?.portrait ?? '' }
              },
              attempt === 'fresh-grid'
                ? 'driftwood-isle'
                : 'open-plot-ember-forge',
            )
            const loaded = page.waitForEvent('domcontentloaded', {
              timeout: 60000,
            })
            await page.locator('.ws-main-grid').click()
            await loaded
          } else
            // CHUNK-PARAM CP17 (J522): the card a player sees after a tap, so the zone is entered by the tap
            await enterZone(page, {
              zone: shard,
              base: preview.url,
              flags: 'tier=phone&mute=1&nolock=1&sw=0',
              waitUntil: 'commit',
              timeout: 30000,
            })
          await page.waitForFunction(
            () => document.querySelector('.ws-load:not([data-shell])') !== null,
            null,
            { timeout: 60000 },
          )
          await page.screenshot({ path: join(out, `${tag}-loading.png`) })
          await page.waitForSelector('.ws-load[data-ready]', {
            timeout: 120000,
          })
          await page.waitForTimeout(300)
          await page.screenshot({ path: join(out, `${tag}-ready.png`) })
          if (destination !== null) {
            const first = await page.evaluate(() =>
              Reflect.get(window, '__firstLoadingFrame'),
            )
            const adopted = await page.evaluate(() => ({
              name: document.querySelector('.ws-load [data-el=slug]')
                ?.textContent,
              art: getComputedStyle(document.documentElement)
                .getPropertyValue('--ws-load-portrait')
                .trim(),
            }))
            const matches = (
              /** @type {{name:string|undefined,art:string}|null} */ view,
            ) =>
              view?.name === destination.name &&
              (destination.art === ''
                ? view.art === 'none'
                : view.art.includes(destination.art))
            if (!matches(first) || !matches(adopted))
              faults.push(`saved-place card mismatch for ${attempt}`)
            if (attempt === 'missing-art' && destination.art !== '')
              faults.push('missing-art fixture did not remove art')
            console.log(
              `${tag}: first/adopted destination ${matches(first) && matches(adopted) ? 'ok' : 'FAILED'}, art ${destination.art === '' ? 'none' : 'own'}`,
            )
          }
          // Forward the native write and preserve rejection. Only a trusted locator
          // click may trigger Copy; read back only after this proof's own write won.
          await page.evaluate(() => {
            const original = navigator.clipboard.writeText.bind(
              navigator.clipboard,
            )
            Reflect.set(window, '__nativeCopy', original)
            navigator.clipboard.writeText = text => {
              const raw =
                /** @type {import('../shared/engine/boot/timing').BootTiming} */ (
                  Reflect.get(window, '__bootTiming')
                ).read()
              const spans = raw.entries
                .filter(row => row.end !== null && row.end > row.start)
                .sort(
                  (a, b) => (b.end ?? 0) - b.start - ((a.end ?? 0) - a.start),
                )
                .slice(0, 15)
              const duration = (
                /** @type {Readonly<Record<string,unknown>>} */ row,
              ) =>
                Number(
                  row.duration ??
                    Number(row.responseEnd ?? 0) - Number(row.startTime ?? 0),
                )
              const resources = [...raw.resources]
                .sort((a, b) => duration(b) - duration(a))
                .slice(0, 10)
              const network = raw.resources.filter(
                  row => Number(row.transferSize) > 0,
                ),
                cache = raw.resources.filter(
                  row =>
                    row.transferSize === 0 && Number(row.encodedBodySize) > 0,
                )
              const end = Math.max(
                0,
                ...raw.entries
                  .filter(row => row.realm === 'page')
                  .map(row => row.end ?? row.start),
              )
              const edges = [
                { at: 0, change: 0 },
                { at: end, change: 0 },
              ]
              const cover = (
                /** @type {unknown} */ start,
                /** @type {unknown} */ finish,
              ) => {
                if (
                  typeof start !== 'number' ||
                  typeof finish !== 'number' ||
                  !Number.isFinite(start) ||
                  !Number.isFinite(finish)
                )
                  return
                const left = Math.max(0, start),
                  right = Math.min(end, finish)
                if (right > left)
                  edges.push({ at: left, change: 1 }, { at: right, change: -1 })
              }
              for (const row of raw.resources)
                cover(
                  row.pageStart ??
                    (row.realm === 'page' ? row.startTime : undefined),
                  row.pageEnd ??
                    (row.realm === 'page' ? row.responseEnd : undefined),
                )
              if (raw.navigation !== undefined)
                cover(raw.navigation.startTime ?? 0, raw.navigation.responseEnd)
              const gaps = /** @type {Array<[number,number]>} */ ([])
              let active = 0,
                previous = 0
              for (const edge of edges.sort((a, b) => a.at - b.at)) {
                if (active === 0 && edge.at - previous > 500)
                  gaps.push([previous / 1000, (edge.at - previous) / 1000])
                active += edge.change
                previous = edge.at
              }
              const expected = {
                entries: raw.entries.length,
                resources: raw.resources.length,
                spans: spans.map(
                  row =>
                    `[${row.realm}] ${(row.start / 1000).toFixed(2)} + ${(((row.end ?? 0) - row.start) / 1000).toFixed(2)}`,
                ),
                slow: resources.map(
                  row =>
                    `${Number(row.transferSize) > 0 ? row.transferSize : (row.encodedBodySize ?? 0)} B ${(duration(row) / 1000).toFixed(2)} s ${Number(row.transferSize) > 0 ? 'network' : row.transferSize === 0 && Number(row.encodedBodySize) > 0 ? 'cache' : 'unknown'}`,
                ),
                gaps,
                totals: `network ${network.length} / ${network.reduce((sum, row) => sum + Number(row.transferSize), 0)} B; cache ${cache.length} / ${cache.reduce((sum, row) => sum + Number(row.encodedBodySize), 0)} B`,
              }
              const receipt = { text, expected, settled: false, success: false }
              Reflect.set(window, '__copyReceipt', receipt)
              return original(text).then(
                () => {
                  receipt.settled = true
                  receipt.success = true
                  return undefined
                },
                (/** @type {unknown} */ error) => {
                  receipt.settled = true
                  throw error
                },
              )
            }
          })
          await page.locator('.ws-load-copy').click()
          await page.waitForFunction(
            () => Reflect.get(window, '__copyReceipt')?.settled === true,
          )
          const copied = await page.evaluate(async () => {
            const receipt = Reflect.get(window, '__copyReceipt')
            if (receipt.success !== true)
              return { ok: false, reason: 'native write rejected' }
            const native = await navigator.clipboard.readText()
            if (native !== receipt.text)
              return { ok: false, reason: 'native readback differs' }
            const marker = 'timeline (LS1):\n',
              at = native.indexOf(marker)
            if (at === -1) return { ok: false, reason: 'no timeline digest' }
            const expected = receipt.expected,
              bytes = new TextEncoder().encode(native).byteLength
            const gapText = native
              .split('\n')
              .find(line => line.startsWith('request-free gaps >0.5 s'))
              ?.split(': ')[1]
            const gaps = /** @type {Array<[number,number]>} */ ([])
            for (const item of gapText === undefined || gapText === 'none'
              ? []
              : gapText.split(', ')) {
              const match =
                /^(\d+(?:\.\d+)?)\+(\d+(?:\.\d+)?)(?: every (\d+(?:\.\d+)?) x(\d+))?$/u.exec(
                  item,
                )
              if (match === null)
                return { ok: false, reason: 'unreadable gap interval' }
              for (let index = 0; index < Number(match[4] ?? 1); index++)
                gaps.push([
                  Number(match[1]) + index * Number(match[3] ?? 0),
                  Number(match[2]),
                ])
            }
            const gapsMatch =
              gaps.length === expected.gaps.length &&
              gaps.every(([start, ms], index) => {
                const held = expected.gaps[index]
                return (
                  held !== undefined &&
                  start.toFixed(3) === held[0].toFixed(3) &&
                  ms.toFixed(3) === held[1].toFixed(3)
                )
              })
            const complete =
              native.includes(`counts: ${expected.entries} spans (`) &&
              native.includes(`${expected.resources} resources;`) &&
              native.includes('longest spans (start s + duration s):') &&
              native.includes(
                'slowest resources (bytes, duration s, source):',
              ) &&
              native.includes('request-free gaps >0.5 s') &&
              !native.includes('"entries":') &&
              expected.spans.every((/** @type {string} */ fact) =>
                native.includes(fact),
              ) &&
              expected.slow.every((/** @type {string} */ fact) =>
                native.includes(fact),
              ) &&
              native.includes(expected.totals) &&
              gapsMatch
            return {
              ok:
                complete &&
                bytes < 6000 &&
                document.querySelector('.ws-load-copy')?.textContent ===
                  'Copied',
              reason: complete
                ? `compact safe report: ${bytes} bytes, ${expected.entries} spans, ${expected.resources} resources`
                : 'missing compact timeline facts',
            }
          })
          if (!copied.ok) faults.push(`copy diagnostics: ${copied.reason}`)
          console.log(
            `${tag}: native copy ${copied.ok ? 'ok' : 'FAILED'} · ${copied.reason}`,
          )
          // Fault injection proves the real control exposes refusal; it is separate
          // from the native successful transfer above and grants no progress credit.
          await page.evaluate(() => {
            navigator.clipboard.writeText = () =>
              Promise.reject(
                new DOMException('Proof refusal', 'NotAllowedError'),
              )
          })
          await page.locator('.ws-load-copy').click()
          await page.waitForFunction(
            () =>
              document.querySelector('.ws-load-copy')?.textContent ===
              'Copy failed',
          )
          await page.evaluate(() => {
            navigator.clipboard.writeText = Reflect.get(window, '__nativeCopy')
          })
          const log = await page.evaluate(() => Reflect.get(window, '__barLog'))
          const readyAt = await page.evaluate(() =>
            Reflect.get(window, '__readyAt'),
          )
          if (process.argv.includes('--dump'))
            writeFileSync(
              join(out, `${tag}-timing.json`),
              JSON.stringify(
                await page.evaluate(() =>
                  Reflect.get(window, '__bootTiming')?.read(),
                ),
                null,
                1,
              ),
            )
          // LS7: each Load row's own measured ms (the card's timeline, exclusive of nested work), the source of its bar weight
          if (process.argv.includes('--dump'))
            writeFileSync(
              join(out, `${tag}-rows.json`),
              JSON.stringify(
                await page.evaluate(() => {
                  const card = document.querySelector('.ws-load')
                  /** @type {{path?: string, rows?: {key: string, state: string, ms: number, weight?: number}[]} | undefined} */
                  const snapshot =
                    card === null
                      ? undefined
                      : Reflect.get(card, Symbol.for('engine.loading.snapshot'))
                  return {
                    path: snapshot?.path,
                    rows: (snapshot?.rows ?? []).map(
                      ({ key, state, ms, weight }) => ({
                        key,
                        state,
                        ms,
                        weight,
                      }),
                    ),
                  }
                }),
                null,
                1,
              ),
            )
          const counts = await page.evaluate(() =>
            Reflect.get(window, '__countLog'),
          )
          const lastCount = counts.at(-1)
          const measured =
            lastCount !== undefined &&
            lastCount.startBytes > 0 &&
            lastCount.startTotal >= lastCount.startBytes &&
            lastCount.serverSteps > 0 &&
            lastCount.serverFiles > 0 &&
            lastCount.serverBytes > 0
          console.log(
            `${tag}: measured counts ${measured ? 'ok' : 'FAILED'} ${JSON.stringify(lastCount)}`,
          )
          if (!measured)
            faults.push(
              'Start code bytes or Server internal work counts absent',
            )
          const row = {
            tag,
            faults: /** @type {string[]} */ ([]),
            log,
            readyAt,
            counts,
          }
          report.push(row)
          if (grid) {
            await page.locator('.ws-load-play').click()
            await page.waitForFunction(
              () => document.querySelector('.ws-load') === null,
            )
            await entered(page)
            const cell = await settled(
              page,
              attempt === 'fresh-grid' ? 'driftwood-isle' : 'open-plot-4-1',
            )
            if (cell.board !== null || cell.closed !== null)
              throw new Error(
                'Entered cell retained its board or lost the server',
              )
            if (
              attempt !== 'fresh-grid' &&
              (earnedPose === null ||
                Math.hypot(
                  cell.serverX - earnedPose.x,
                  cell.serverZ - earnedPose.z,
                ) > 0.003)
            )
              throw new Error('Saved card disagrees with actual resumed pose')
            console.log(
              `${tag}: actual entered cell ${cell.current}, closed board`,
            )
            if (attempt === 'fresh-grid') {
              console.log(
                `${tag}: native renderer`,
                await page.evaluate(() => {
                  const world = Reflect.get(window, '__wildshard').world
                  if (world === undefined)
                    throw new Error(
                      'No live world for native renderer observation',
                    )
                  const gl = world.game.renderer.getContext(),
                    extension = gl.getExtension('WEBGL_debug_renderer_info')
                  return extension === null
                    ? gl.getParameter(gl.RENDERER)
                    : gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                }),
              )
              console.log(`${tag}: ordinary road leg 1`)
              await walkGrid(page, 0, -281.25)
              console.log(`${tag}: ordinary road leg 2`)
              await walkGrid(page, 1125, -281.25)
              console.log(`${tag}: ordinary Ember entry`)
              await walkGrid(page, 1125, -390)
              console.log(
                `${tag}: real Ember crossing`,
                JSON.stringify(await settled(page, 'open-plot-4-1')),
              )
              await page.evaluate(() => {
                const save = Reflect.get(window, '__workerClientSave')
                if (save === undefined) throw new Error('No real save control')
                return save()
              })
              const saved = await observed(page)
              if (!saved.saved)
                throw new Error('Real Ember save was not acknowledged')
              earnedPose = { x: saved.serverX, z: saved.serverZ }
            }
            if (attempt !== 'missing-art') {
              if (attempt === 'saved-ember') await omitEmberArt()
              await page.evaluate(() => {
                const game = Reflect.get(window, '__wildshard')
                if (game?.world === undefined) throw new Error('No live world')
                game.world.hud.setPaused(true)
              })
              await page.getByText('Exit to main', { exact: true }).click()
              await page.locator('.ws-main-grid').waitFor({ timeout: 60000 })
            }
          }
          row.faults = faults.slice(faultCursor)
          faultCursor = faults.length
        }
      } finally {
        await context.close()
      }
    } finally {
      await browser?.close()
      if (profile !== null) rmSync(profile, { recursive: true })
    }
  }
} finally {
  preview.close()
}
let failed = false
for (const { tag, faults, log, readyAt, counts } of report) {
  // The rule's window opens when the first card paints a bar, before any module (the inline Start counter).
  const opened = log[0]?.t ?? 0,
    { stalls, backwards } = barStalls(log, opened, readyAt),
    untraced = untracedChanges(log)
  console.log(
    `${tag}: ready ${(readyAt / 1000).toFixed(1)} s, ${log.filter((/** @type {{bar: string}} */ row) => row.bar !== 'step').length} bar changes, ` +
      `${stalls.length} stalls over 2 s, ${backwards.length} backwards, ${untraced.length} untraced, faults ${faults.length}${faults.length > 0 ? `: ${faults.join(' | ')}` : ''}`,
  )
  for (const stall of stalls)
    console.log(
      `  stall ${(stall.ms / 1000).toFixed(1)} s at ${(stall.from / 1000).toFixed(1)} s: needs finer feedback in ${stall.stages.join(' > ') || 'unnamed'}`,
    )
  for (const row of untraced)
    console.log(
      `  untraced ${row.bar} -> ${row.pct}% at ${(row.t / 1000).toFixed(2)} s (${row.step})`,
    )
  writeFileSync(
    join(out, `${tag}-bars.json`),
    JSON.stringify({ readyAt, stalls, backwards, untraced, log, counts }),
  )
  failed ||=
    backwards.length > 0 ||
    untraced.length > 0 ||
    faults.length > 0 ||
    (process.argv.includes('--strict') && stalls.length > 0)
}
if (failed) process.exitCode = 1
console.log(`shots in ${out}`)
