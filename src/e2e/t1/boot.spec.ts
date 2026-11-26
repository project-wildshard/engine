import { expect, test } from './fixtures.ts'
import { oldLinkIsTitle } from './old-link.ts'
import { inPlay, state } from './probe.ts'

test('Brasscap reaches control through its title', async ({
  page,
}): Promise<void> => {
  await inPlay(page)
  const seated = await state(page)
  expect(seated.slug).toBe('brasscap-mesa')
})

test('CP22: an old chunk link is the title, with no seat, no modal and its address kept', async ({
  browser,
  baseURL,
}): Promise<void> => {
  await oldLinkIsTitle(browser, baseURL ?? '')
})
