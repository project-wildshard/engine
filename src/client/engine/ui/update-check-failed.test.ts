// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';

afterEach(async () => {
  const shown = document.querySelector('.ws-update');
  if (shown !== null) (await import('./hudSlots')).hudSlots.ownerOf(shown)?.dispose();
  (await import('../../../shared/engine/app/resources')).pageScope.dispose();
  document.body.replaceChildren(); (await import('../core/devMode')).setDev(false);
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

test('FM5 mode 13: a failed /version.json read is a Developer-only line on the pill; a player sees nothing; the next poll that answers clears it', async () => {
  vi.useFakeTimers(); vi.stubGlobal('__BUILD_ID__', 'fixture-now');
  let status = 503;
  vi.stubGlobal('fetch', () => Promise.resolve(status === 200 ? Response.json({ build: 'fixture-now' }) : new Response('down', { status })));
  document.body.innerHTML = '<div id="hud" class="intro"><div class="ws-menu"></div></div>';
  await import('./Update');
  await vi.advanceTimersByTimeAsync(100);
  const node = document.querySelector('.ws-update');
  if (!(node instanceof HTMLButtonElement)) throw new Error('Missing update pill');
  expect(node.dataset['failmode'], 'a player: play is not affected').toBeUndefined();
  expect(node.textContent).not.toMatch(/failed/u);
  (await import('../core/devMode')).setDev(true);
  expect(node.dataset['failmode']).toBe('version-http');
  expect(node.textContent).toMatch(/Update check failed · next in 5 min/u);
  expect(node.title, 'the status stays out of the words').toContain('503');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(node.textContent).toMatch(/next in 4 min/u);
  status = 200;
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  expect(node.dataset['failmode']).toBeUndefined();
  expect(node.textContent).not.toMatch(/failed/u);
});
