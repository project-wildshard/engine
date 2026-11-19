import { enterBrasscap, test } from './fixtures.ts'
import { expectOpenGate, openGate } from './save-gate.ts'

test('Exit to Title keeps the canyon gate in an independent save', async ({
  freshPage,
}): Promise<void> => {
  const page = await freshPage()
  await openGate(page)
  await page.keyboard.press('Escape')
  await page.locator('.ws-gmenu.show:not([inert]) .ws-gmenu-exit').click()
  await enterBrasscap(page)
  await expectOpenGate(page)
})
