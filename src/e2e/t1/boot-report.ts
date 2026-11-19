import { takePlayMarks } from './probe.ts'
import { smokeReceipt } from './smoke-receipt.ts'

import type { BrowserContext, Page } from '@playwright/test'

interface BootSpan {
  readonly operation: string
  readonly start: number
  readonly end: number
}

/** One `__bootTiming` entry as a span; a mark (control) may carry no end. */
function bootSpan(row: unknown): BootSpan | undefined {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('operation' in row) ||
    !('start' in row) ||
    typeof row.operation !== 'string' ||
    typeof row.start !== 'number'
  ) {
    return undefined
  }
  const end = 'end' in row && typeof row.end === 'number' ? row.end : row.start
  return { operation: row.operation, start: row.start, end }
}

function bootStage(span: BootSpan | undefined): string | undefined {
  if (span?.operation === 'app:control-ready') {
    return `control@${(span.start / 1000).toFixed(1)}`
  }
  if (
    span === undefined ||
    !span.operation.startsWith('stage:') ||
    span.end - span.start < 500
  ) {
    return undefined
  }
  const name = span.operation.slice('stage:'.length)
  return `${name} ${((span.end - span.start) / 1000).toFixed(1)}@${(span.start / 1000).toFixed(1)}`
}

/** Brasscap entries per browser context: the first is a cold boot, later ones warm (TB-4b's receipt profile). */
const brasscapEntries = new WeakMap<BrowserContext, number>()

/** TR-4b: one stdout line per Brasscap entry with every loader stage of 0.5 s or more (its `stage:*` spans in start
 *  order: seconds, then @ seconds into the entered document), so a hosted suite killed at its budget still says where
 *  its time went. `doc` is the entered document's age at control; the rest of `in play after` is the title's. */
async function reportBoot(
  page: Page,
  startedAt: number,
  reached = 'Brasscap in play',
): Promise<void> {
  const steps = await page
    .evaluate((): { doc: number; entries: unknown } => {
      const timing: unknown = Reflect.get(globalThis, '__bootTiming')
      return {
        doc: performance.now(),
        entries:
          typeof timing === 'object' && timing !== null && 'entries' in timing
            ? timing.entries
            : [],
      }
    })
    .then((read: Readonly<{ doc: number; entries: unknown }>): string => {
      const { doc, entries } = read
      const rows = Array.isArray(entries) ? (entries as unknown[]) : []
      const stages = rows
        .map((row): string | undefined => bootStage(bootSpan(row)))
        .filter((line): line is string => line !== undefined)
      return `doc ${(doc / 1000).toFixed(1)}; ${stages.join(', ')}`
    })
    .catch((): string => 'steps unread')
  const play = takePlayMarks(page).join(', ')
  process.stdout.write(
    `[t1-boot] ${reached} after ${((Date.now() - startedAt) / 1000).toFixed(1)} s (${steps}; ${play})\n`,
  )
  if (reached === 'Brasscap in play') {
    const entry = (brasscapEntries.get(page.context()) ?? 0) + 1
    brasscapEntries.set(page.context(), entry)
    await smokeReceipt(page, entry)
  }
}

/** TB-4b's planted fault rides with the receipt it proves; fixtures reaches both through here. */
export { reportBoot }
export { plantDecodeDelay } from './smoke-receipt.ts'
