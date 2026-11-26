import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import {
  readSmokeHistory,
  smokeSplitRegression,
} from '../../scripts/smoke-split-history.mjs'

import type { SmokeReceipt } from '../../scripts/smoke-split-history.mjs'
import type { Page } from '@playwright/test'

interface Span {
  readonly operation: string
  readonly start: number
  readonly end: number
}

type Part = readonly [number, number]

/** TEMPLATE-E2E TB-4b: the decode leaf. Every model decode (rigParser's `GLTF decode` waits) and texture decode
 *  (`texture:decode`, `texture:layer-decode`) of the boot, as the wall time their union covers. */
const DECODE = /^(?:wait:GLTF decode |texture:(?:layer-)?decode )/u
const RECEIPTS = path.join(homedir(), '.cache/wildshard/lane-receipts.log')
const MARKER = 'TEMPLATE_SMOKE '
const STABLE_MS = 250

/** A leaf's stable duration: whole quarter seconds, down. The comparator flags 30 % growth, which on a 2 ms stage or
 *  an 18 ms decode is noise; TB-0's bar is stretches over 0.5 s. A leaf under a quarter second is dropped, except the
 *  decode leaf, which is always recorded (its usual 0 is the baseline a planted 3 s grows from). */
function stableMs(ms: number): number {
  return Math.floor(Math.max(0, ms) / STABLE_MS) * STABLE_MS
}

/** The length of the union of `spans` clipped to [from, to]: each part merges every disjoint run it touches. */
function covered(spans: readonly Span[], from: number, to: number): number {
  let runs: readonly Part[] = []
  for (const span of spans) {
    let start = Math.max(from, span.start)
    let end = Math.min(to, span.end)
    if (end > start) {
      const apart: Part[] = []
      for (const [runStart, runEnd] of runs) {
        if (runEnd < start || runStart > end) {
          apart.push([runStart, runEnd])
        } else {
          start = Math.min(start, runStart)
          end = Math.max(end, runEnd)
        }
      }
      runs = [...apart, [start, end]]
    }
  }
  return runs.reduce(
    (sum: number, [runStart, runEnd]: Part): number => sum + runEnd - runStart,
    0,
  )
}

/** The boot's stable leaves (ms, `stableMs`): each loader stage's own time, less the other stages and the decodes
 *  inside it, so an aggregate parent (`finish` holds home to firstFrame) never counts a child twice, plus `packDecode`. */
function bootLeaves(spans: readonly Span[]): Record<string, number> {
  const stages = new Map<string, Span>()
  // The last of a name wins: a same-page re-entry's own stage
  for (const span of spans) {
    if (span.operation.startsWith('stage:')) {
      stages.set(span.operation.slice('stage:'.length), span)
    }
  }
  const decodes = spans.filter((span: Readonly<Span>): boolean =>
    DECODE.test(span.operation),
  )
  const split: Record<string, number> = {}
  for (const [name, stage] of stages) {
    const inner = [...stages.values()].filter(
      (other: Readonly<Span>): boolean =>
        other !== stage &&
        other.start >= stage.start &&
        other.end <= stage.end &&
        other.end - other.start < stage.end - stage.start,
    )
    const stable = stableMs(
      stage.end -
        stage.start -
        covered([...inner, ...decodes], stage.start, stage.end),
    )
    if (stable > 0) {
      split[name] = stable
    }
  }
  split['packDecode'] = stableMs(
    covered(decodes, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
  )
  return split
}

/** TB-4b's planted fault (WS_T1_FAULT=decode-delay): the first model the page decodes holds its decode 3 s, inside
 *  GLTFLoader's own parse (the GLB's JSON chunk is read through TextDecoder there), so only the decode leaf grows. */
function plantDecodeDelay(): void {
  // The e2e realm types no DOM: the page's TextDecoder, as far as this needs it
  const proto: unknown = Reflect.get(TextDecoder, 'prototype')
  const original: unknown =
    typeof proto === 'object' && proto !== null
      ? Reflect.get(proto, 'decode')
      : undefined
  if (
    typeof proto !== 'object' ||
    proto === null ||
    typeof original !== 'function'
  ) {
    return
  }
  let planted = false
  // Only while rigParser's `GLTF decode` wait is open: the region's admission reads a GLB's JSON earlier, no decode.
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- an init script ships this one function to the page
  const decoding = (): boolean => {
    const timing: unknown = Reflect.get(globalThis, '__bootTiming')
    const rows: unknown =
      typeof timing === 'object' && timing !== null
        ? Reflect.get(timing, 'entries')
        : undefined
    return (Array.isArray(rows) ? (rows as unknown[]) : [])
      .slice(-64)
      .some(
        (row): boolean =>
          typeof row === 'object' &&
          row !== null &&
          'operation' in row &&
          'end' in row &&
          row.end === null &&
          typeof row.operation === 'string' &&
          row.operation.startsWith('wait:GLTF decode '),
      )
  }
  Reflect.set(
    proto,
    'decode',
    function decode(this: unknown, ...args: readonly unknown[]): unknown {
      const text: unknown = Reflect.apply(original, this, args)
      if (
        !planted &&
        typeof text === 'string' &&
        text.startsWith('{"asset"') &&
        decoding()
      ) {
        planted = true
        const until = performance.now() + 3000
        while (performance.now() < until) {
          // A real 3 s of decode on the page's thread
        }
      }
      return text
    },
  )
}

/** The entry's spans from the page's boot timeline (closed ones only). */
async function readSpans(page: Page): Promise<readonly Span[]> {
  return await page.evaluate((): Span[] => {
    const timing: unknown = Reflect.get(globalThis, '__bootTiming')
    const rows: unknown =
      typeof timing === 'object' && timing !== null
        ? Reflect.get(timing, 'entries')
        : undefined
    const spans: Span[] = []
    for (const row of Array.isArray(rows) ? (rows as unknown[]) : []) {
      if (
        typeof row === 'object' &&
        row !== null &&
        'operation' in row &&
        'start' in row &&
        'end' in row &&
        typeof row.operation === 'string' &&
        typeof row.start === 'number' &&
        typeof row.end === 'number'
      ) {
        spans.push({ operation: row.operation, start: row.start, end: row.end })
      }
    }
    return spans
  })
}

/** TB-4b: one receipt per Brasscap entry. Local runs append it to the lane receipt log (hosted runners have none) and
 *  every run prints its leaves against the preceding week of the same profile: `[t1-smoke] <profile> flagged: ...`.
 *  A planted fault (WS_T1_FAULT) prints its verdict but never becomes history. */
async function smokeReceipt(page: Page, entry: number): Promise<void> {
  const split = bootLeaves(await readSpans(page).catch((): Span[] => []))
  if (Object.keys(split).length <= 1) {
    return
  }
  const width = page.viewportSize()?.width ?? 0
  const gl =
    process.env['WS_T1_ANGLE'] ??
    (process.platform === 'darwin' ? 'metal' : 'default')
  const profile = `${process.platform}-${gl}-${width < 600 ? 'phone' : 'desktop'}-${entry === 1 ? 'cold' : 'warm'}`
  const current: SmokeReceipt = {
    at: new Date().toISOString(),
    profile,
    split,
  }
  const history = existsSync(RECEIPTS)
    ? readSmokeHistory(readFileSync(RECEIPTS, 'utf8'))
    : []
  const flagged = smokeSplitRegression(current, history).filter(
    (row): boolean => row.flagged,
  )
  const fault = process.env['WS_T1_FAULT'] ?? ''
  const said = flagged
    .map(
      (row): string =>
        `${row.name} ${String(row.ms)} ms (week median ${String(Math.round(row.medianMs ?? 0))} ms of ${String(row.samples)})`,
    )
    .join(', ')
  process.stdout.write(
    `[t1-smoke] ${profile}${fault === '' ? '' : ` fault=${fault}`} flagged: ${said === '' ? 'none' : said}; leaves ${JSON.stringify(split)}\n`,
  )
  if (
    fault === '' &&
    process.env['CI'] === undefined &&
    existsSync(path.dirname(RECEIPTS))
  ) {
    appendFileSync(
      RECEIPTS,
      `${current.at.slice(11, 16)} UTC t1-smoke ${MARKER}${JSON.stringify(current)}\n`,
    )
  }
}

export { bootLeaves, plantDecodeDelay, smokeReceipt }
