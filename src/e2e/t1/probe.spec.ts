import { expect, test } from './fixtures.ts'
import { inPlay, poseAt, state } from './probe.ts'

test('probe helpers read the seated world and resolve a pinned POI', async ({
  page,
}): Promise<void> => {
  await inPlay(page)
  const before = await state(page)
  expect(before.slug).toBe('brasscap-mesa')
  expect(before.health).toBeGreaterThan(0)
  await page.keyboard.press('Escape', { delay: 100 })
  await expect(page.locator('.ws-gmenu.show:not([inert])')).toBeVisible()
  await inPlay(page)
  await expect(page.locator('.ws-gmenu.show:not([inert])')).toHaveCount(0)
  const poi = await poseAt(page, 'depot')
  const after = await state(page)
  expect(after.pos.x).toBeCloseTo(poi.x, 1)
  expect(after.pos.z).toBeCloseTo(poi.z, 1)
  expect(after.flags).toEqual(expect.any(Array))
  await expect(poseAt(page, 'missing-poi')).rejects.toThrow(
    'Unknown or invalid Brasscap POI',
  )
})
