import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { brotliDecompressSync } from 'node:zlib'

import {
  array,
  literal,
  looseObject,
  number,
  optional,
  parse,
  string,
} from 'valibot'

import { enterBrasscap, expect, test } from './fixtures.ts'
import { state } from './probe.ts'

const pinSchema = looseObject({
  file: string(),
  bytes: number(),
  sha256: string(),
  saveEpoch: number(),
  refused: string(),
  slug: string(),
  formerSlug: optional(string()),
  tick: number(),
})
const shardSchema = looseObject({ slug: string(), hash: string() })
const pinsSchema = looseObject({ shards: array(shardSchema) })
const flagsSchema = array(string())
const stateSchema = looseObject({ tick: number() })
const savedSchema = looseObject({
  levelId: string(),
  flags: flagsSchema,
  state: stateSchema,
})
const snapshotSchema = looseObject({
  format: literal('sim.snapshot'),
  version: literal(3),
  snapshot: savedSchema,
})

// The released snapshot has no flags. Like released-save-play.test.ts,
// add one probe to a decoded copy to make progress carry observable.
const CARRIED_FLAG = 'released-save.probe'
// WR8b: the v0.1.1 pin is epoch 1, a codec pin since the epoch-2 cut. Its
// snapshot is epoch-free, so the file carries it under the current epoch;
// the save menu refuses any other epoch on purpose.
const EPOCH = parse(
  looseObject({ saveEpoch: number() }),
  JSON.parse(readFileSync('save-epoch.json', 'utf8')),
).saveEpoch
function releasedFile(instance: string): string {
  const pin = parse(
    pinSchema,
    JSON.parse(readFileSync('test/pins/saves/brasscap-mesa.json', 'utf8')),
  )
  const pins = parse(
    pinsSchema,
    JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')),
  )
  expect(pin.refused).toBe(
    pins.shards.find(
      (row: Readonly<{ slug: string }>): boolean => row.slug === pin.slug,
    )?.hash,
  )
  const bytes = readFileSync(`test/pins/saves/${pin.file}`)
  expect(bytes.byteLength).toBe(pin.bytes)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.sha256)
  const wire = parse(
    snapshotSchema,
    JSON.parse(brotliDecompressSync(bytes).toString('utf8')),
  )
  const { snapshot } = wire
  // TC-SHIP-a: Brasscap's v0.1.1 save names its level by the retired slug.
  expect(snapshot.levelId).toBe(pin.formerSlug ?? pin.slug)
  expect(snapshot.state.tick).toBe(pin.tick)
  expect(pin.saveEpoch).toBeLessThanOrEqual(EPOCH)
  snapshot.flags.push(CARRIED_FLAG)
  return JSON.stringify({
    format: 'wildshard.save',
    version: 2,
    saveEpoch: EPOCH,
    server: true,
    docs: {
      [`standalone-${instance}`]: {
        keys: {
          continuation: {
            // oxlint-disable-next-line id-length -- Public save envelope version key.
            v: 1,
            data: {
              tick: pin.tick,
              snapshot: JSON.stringify(wire),
            },
          },
        },
      },
    },
  })
}

test('released Brasscap world is refused while its progress carries', async ({
  freshPage,
}): Promise<void> => {
  const page = await freshPage()
  const instance = await page.evaluate(
    (): string | null | undefined => globalThis.__wildshard?.area()?.instance,
  )
  if (typeof instance !== 'string') {
    throw new TypeError('Missing Brasscap cell identity')
  }
  const file = releasedFile(instance)
  await page.keyboard.press('Escape')
  const menu = page.locator('.ws-gmenu.show:not([inert])')
  // J458: Saves is System ▸ Progress file
  await menu.locator('[data-sv-tab="system"]').click()
  await menu.locator('input[type=file]').setInputFiles({
    name: 'released-brasscap.json',
    mimeType: 'application/json',
    buffer: Buffer.from(file),
  })
  await expect(
    menu
      .locator('.ws-gmenu-card')
      .filter({ has: page.locator('input[type=file]') })
      .locator('[role=status]'),
  ).toContainText('Imported 1 keys. Skipped 0 keys.')
  await page.reload()
  await enterBrasscap(page)
  await expect
    .poll(async (): Promise<readonly string[]> => {
      const view = await state(page)
      return view.flags
    })
    .toContain(CARRIED_FLAG)
  // Read the real server store: only restore refusal creates this copy.
  const copies: unknown = await page.evaluate(`(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('wildshard-saves@${String(EPOCH)}', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const store = db.transaction('saves').objectStore('saves');
      const keys = await new Promise((resolve, reject) => {
        const request = store.getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return keys.filter(key => typeof key === 'string' && key.endsWith('.corrupt.restore'));
    } finally { db.close(); }
  })()`)
  expect(copies).toEqual(
    expect.arrayContaining([
      expect.stringContaining(`standalone-${instance}.corrupt.restore`),
    ]),
  )
})
