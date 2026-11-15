import { expect, test } from './fixtures.ts'
import { inPlay, state } from './probe.ts'

test('Template 1 reaches control through its title', async ({
  page,
}): Promise<void> => {
  await inPlay(page)
  const seated = await state(page)
  expect(seated.slug).toBe('_template')
})
