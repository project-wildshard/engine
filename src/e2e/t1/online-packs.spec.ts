import { load503 } from './online-entry.ts'
import { test } from './online-fixtures.ts'

test.use({ rigGroup: 'entry' })

test('a matched pack 503 keeps bad bytes out and heals to Brasscap control', async ({
  browser,
  rig,
}): Promise<void> => {
  await load503(browser, rig, 'packs')
})
