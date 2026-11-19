import { expect, test } from './fixtures.ts'
import { inPlay, state } from './probe.ts'

test('Brasscap reaches control through its title', async ({
  page,
}): Promise<void> => {
  await inPlay(page)
  const seated = await state(page)
  expect(seated.slug).toBe('brasscap-mesa')
})
