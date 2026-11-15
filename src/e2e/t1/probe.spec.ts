import { expect, test } from './fixtures.ts'
import { inPlay, poseAt, state } from './probe.ts'

test('probe helpers read the seated world and resolve a pinned POI', async ({
  page,
}): Promise<void> => {
  await inPlay(page)
  const before = await state(page)
  expect(before.slug).toBe('_template')
  expect(before.health).toBeGreaterThan(0)
  const poi = await poseAt(page, 'lamplighter')
  const after = await state(page)
  expect(after.pos.x).toBeCloseTo(poi.x, 1)
  expect(after.pos.z).toBeCloseTo(poi.z, 1)
  expect(after.flags).toEqual(expect.any(Array))
  await expect(poseAt(page, 'missing-poi')).rejects.toThrow(
    'Unknown or invalid Template 1 POI',
  )
})
