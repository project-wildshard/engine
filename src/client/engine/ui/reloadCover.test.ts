// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { hideReloading, reloadingLine, reloadingShown, showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';

afterEach(() => { hideReloading(); document.body.replaceChildren(); });

test('RL3 / RL4: one call turns the tapped button into a disabled loading button and puts up the full-page cover', () => {
  document.body.innerHTML = '<div class="ws-main"><button class="ws-main-settings">Settings</button><button id="go">Reload</button></div>';
  const go = document.getElementById('go');
  if (!(go instanceof HTMLButtonElement)) throw new Error('Missing button');
  showReloading(go, 'Switching to the new build');
  expect(go.disabled).toBe(true); expect(go.getAttribute('aria-busy')).toBe('true'); expect(go.textContent).toBe('Reloading');
  const cover = document.getElementById('ws-reloading');
  expect(cover?.parentElement).toBe(document.body);
  expect(cover?.style.position).toBe('fixed'); expect(cover?.getAttribute('role')).toBe('status');
  expect(cover?.textContent).toContain('Reloading'); expect(cover?.textContent).toContain('Switching to the new build');
  expect(reloadingShown()).toBe(true);
  // a second call (a second tap) neither stacks a cover nor wraps the button twice
  showReloading(go);
  expect(document.querySelectorAll('#ws-reloading')).toHaveLength(1); expect(go.textContent).toBe('Reloading');
  reloadingLine('The update is slow to switch over · doing a full reload', 'slow');
  expect(cover?.textContent).toContain('slow to switch over');
});

test('RL4: a bfcache return puts the page back as it was', () => {
  document.body.innerHTML = '<button id="go"><b>Reload</b></button>';
  const go = document.getElementById('go');
  if (!(go instanceof HTMLButtonElement)) throw new Error('Missing button');
  showReloading(go);
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  expect(reloadingShown()).toBe(false);
  expect(go.disabled).toBe(false); expect(go.hasAttribute('aria-busy')).toBe(false); expect(go.innerHTML).toBe('<b>Reload</b>');
});

test('RL7: before a reload starts there is no cover, so nothing sits over Settings', () => {
  document.body.innerHTML = '<button class="ws-main-settings">Settings</button>';
  expect(reloadingShown()).toBe(false);
  expect(document.getElementById('ws-reloading')).toBeNull();
});

test('RL3 (iOS Simulator): the navigation waits for one painted frame, never longer than 100 ms, and runs once', async () => {
  vi.useFakeTimers();
  try {
    const go = vi.fn<() => void>();
    showReloading();
    leaveAfterPaint(go);
    // same turn: WebKit would stop painting here, so nothing may navigate yet
    expect(go).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(go).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(go).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});

test('RL4: the cover sits at the top z-index, over the load failure screen', () => {
  showReloading();
  expect(document.getElementById('ws-reloading')?.style.zIndex).toBe('2147483647');
});
