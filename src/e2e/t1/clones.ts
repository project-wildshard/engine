// ENGINE-MEMORY EM25 (design rule 4, "transfer, never clone"): the phone world records every worker message that
// clones 64 KB or more of buffers, on the page (an init script) and inside each dedicated worker (installed as
// Playwright reports the worker, so its replies to the page are seen too; a reply sent before the install lands is
// missed). Chromium only, as T1 is.
import { recordClones } from '../../scripts/memory/cloneRecorder.mjs'

import type { BrowserContext, Page, Worker } from '@playwright/test'

interface CloneRow {
  readonly target: string
  readonly bytes: number
  readonly buffers: number
  readonly stack: string
}
interface Census {
  readonly rows: readonly CloneRow[]
  readonly messages: number
}

const READ = (): string => {
  const rows: unknown = Reflect.get(globalThis, '__cloneLog')
  const seen: unknown = Reflect.get(globalThis, '__cloneSeen')
  return JSON.stringify({
    rows: rows ?? [],
    messages:
      typeof seen === 'object' && seen !== null && 'messages' in seen
        ? seen.messages
        : 0,
  })
}

function isRow(value: unknown): value is CloneRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'target' in value &&
    typeof value.target === 'string' &&
    'bytes' in value &&
    typeof value.bytes === 'number' &&
    'buffers' in value &&
    typeof value.buffers === 'number' &&
    'stack' in value &&
    typeof value.stack === 'string'
  )
}

function parse(value: string, where: string): Census {
  const parsed: unknown = JSON.parse(value)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('rows' in parsed) ||
    !Array.isArray(parsed.rows) ||
    !('messages' in parsed) ||
    typeof parsed.messages !== 'number'
  ) {
    throw new Error('Invalid clone census')
  }
  return {
    rows: parsed.rows
      .filter((row): row is CloneRow => isRow(row))
      .map((row): CloneRow => ({
        target: `${row.target}${where}`,
        bytes: row.bytes,
        buffers: row.buffers,
        stack: row.stack,
      })),
    messages: parsed.messages,
  }
}

async function install(worker: Worker): Promise<void> {
  try {
    await worker.evaluate(recordClones)
  } catch {
    // A worker that closed first posts nothing more
  }
}

/** Install the recorder on `page` (before its first navigation) and in every worker it starts. */
async function watchClones(context: BrowserContext, page: Page): Promise<void> {
  await context.addInitScript(recordClones)
  page.on('worker', (worker: Worker): void => {
    void install(worker)
  })
}

async function workerCensus(worker: Worker): Promise<Census> {
  try {
    return parse(
      await worker.evaluate(READ),
      `@${worker.url().replace(/^.*\//u, '')}`,
    )
  } catch {
    // The worker closed meanwhile
    return { rows: [], messages: 0 }
  }
}

/** Every recorded clone of 64 KB or more since the page opened, page and live workers alike, and the messages seen. */
async function readClones(page: Page): Promise<Census> {
  const all = [
    parse(await page.evaluate(READ), ''),
    ...(await Promise.all(
      page
        .workers()
        .map(async (worker): Promise<Census> => await workerCensus(worker)),
    )),
  ]
  return {
    rows: all.flatMap((census): readonly CloneRow[] => census.rows),
    messages: all.reduce((sum, census): number => sum + census.messages, 0),
  }
}

export { readClones, watchClones }
export type { CloneRow }
