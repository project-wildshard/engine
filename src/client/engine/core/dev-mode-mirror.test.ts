// @vitest-environment happy-dom
import { expect, test } from 'vitest';

test('FM1b: a copy of devMode that reads no saved pick leaves the page\'s Developer mark alone; only setDev takes it away', async () => {
  // index.html marks the page from the saved key before any module runs; a second bundle's copy (online.js) has no storage
  document.documentElement.toggleAttribute('data-dev', true);
  const { isDev, setDev } = await import('./devMode');
  expect(isDev()).toBe(false);
  expect(document.documentElement.dataset['dev'] !== undefined).toBe(true);
  setDev(true); setDev(false);
  expect(document.documentElement.dataset['dev'] !== undefined).toBe(false);
});
