import { expect, test } from './fixtures.ts'

test.describe.configure({ mode: 'serial' })

test('the worker keeps a seated Template 1', async ({
  page,
}): Promise<void> => {
  expect(
    await page.evaluate(
      (): string | undefined => globalThis.__wildshard?.area()?.slug,
    ),
  ).toBe('_template')
  await page.evaluate((): void => {
    Reflect.set(globalThis, '__t1WorldMarker', 'shared-world')
  })
})

test('a second test reuses that world; freshPage is isolated', async ({
  page,
  freshPage,
}): Promise<void> => {
  expect(
    await page.evaluate((): unknown =>
      Reflect.get(globalThis, '__t1WorldMarker'),
    ),
  ).toBe('shared-world')
  const fresh = await freshPage()
  expect(fresh.context()).not.toBe(page.context())
  expect(
    await fresh.evaluate((): unknown =>
      Reflect.get(globalThis, '__t1WorldMarker'),
    ),
  ).toBeUndefined()
  expect(
    await fresh.evaluate(
      (): string | undefined => globalThis.__wildshard?.area()?.slug,
    ),
  ).toBe('_template')
  await fresh.close()
  expect(page.isClosed()).toBe(false)
})
