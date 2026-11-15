import { expect, test } from '@playwright/test'

test('Template 1 is selectable from its title', async ({
  page,
}): Promise<void> => {
  await page.goto('/?mute=1&nolock=1&sw=0')
  await expect(page.locator('.ws-main-select')).toBeVisible()
})
