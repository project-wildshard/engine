// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { beginNavigationShell, loadShellTemplate, startShellClock, stopShellClock } from './shell';
import { saveStorage } from '../saves/slots';

// DL21 (E526): Jake's card sat at 00:00.0 with no shard or tier while ~1.5 MB of boot code arrived (about 3 s on the
// phone link in WebKit, bbceabe). The static card now runs from the entry module until Loading adopts it.
let owner = new Scope('shell-clock');
const field = (name: string): string => document.querySelector(`[data-el="${name}"]`)?.textContent ?? '';
beforeEach(() => {
  owner = new Scope('shell-clock');
  document.body.innerHTML = `<div class="ws-load" data-shell>${loadShellTemplate()}</div>`;
});
afterEach(() => {
  stopShellClock(); owner.dispose(); vi.restoreAllMocks();
  saveStorage('session').removeItem('titleArrival'); saveStorage('device').removeItem('titleArrival.once');
});

test.each([false, true])('navigation owns HUD input and restores prior inert=%s on cancellation', prior => {
  const hud = document.createElement('div'); hud.id = 'hud'; hud.inert = prior; document.body.append(hud);
  let navigations = 0;
  const attempt = beginNavigationShell('Destination', owner, () => { navigations++; });
  expect(hud.inert).toBe(true);
  attempt.dispose();
  expect(hud.inert).toBe(prior);
  expect(navigations).toBe(0);
});

test('the static card counts from the title tap and names the shard, its tier and the code wait', () => {
  // A busy test worker can begin after ten seconds; the tap's clock must still count correctly.
  vi.spyOn(performance, 'now').mockReturnValue(12_500);
  // The title tapped 1.5 s before this document started.
  saveStorage('session').setItem('titleArrival', JSON.stringify({ slug: 'driftwood-isle', mode: 'enter', name: 'Driftwood Isle', tier: 'phone',
    at: performance.timeOrigin - 1500 }));
  startShellClock(owner, 'driftwood-isle');
  expect(field('slug')).toBe('Driftwood Isle'); expect(field('tier')).toBe('phone');
  expect(field('stFact')).toBe('Downloading game code');
  // Loading adopts this start, so its clock continues from the tap.
  expect(document.querySelector<HTMLElement>('.ws-load')?.dataset['clockStartedAt']).toBe('-1500');
  expect(field('clock')).toBe('00:14.0');
});

test('without a fresh arrival the card counts from its document and names the shard from the URL', () => {
  saveStorage('session').setItem('titleArrival', JSON.stringify({ slug: 'pine-hollow', mode: 'enter', name: 'Pine Hollow', at: performance.timeOrigin - 1500 }));
  startShellClock(owner, 'driftwood-isle');
  expect(field('slug')).toBe('driftwood isle'); expect(field('tier')).toBe('');
  expect(document.querySelector<HTMLElement>('.ws-load')?.dataset['clockStartedAt']).toBe('0');
  expect(field('clock')).not.toBe('');
});

test('Loading takes the card over: the shell clock stops, and a page without the shell is untouched', () => {
  startShellClock(owner, 'driftwood-isle'); stopShellClock();
  expect(owner.disposed).toBe(false); expect(field('clock')).not.toBe('');
  document.body.innerHTML = '';
  expect(() => { startShellClock(owner, 'driftwood-isle'); }).not.toThrow();
});
