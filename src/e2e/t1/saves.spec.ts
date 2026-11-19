import { hideAndSave } from '../smoke/game.ts'
import { enterBrasscap, test } from './fixtures.ts'
import { inPlay } from './probe.ts'
import { expectOpenGate, openGate } from './save-gate.ts'

test('the canyon gate survives a save and real reload', async ({
  page,
}): Promise<void> => {
  await openGate(page)
  await hideAndSave(page)
  await page.reload()
  await enterBrasscap(page)
  await inPlay(page)
  await expectOpenGate(page)
})
