// @vitest-environment happy-dom
// LS4 (J188): a failed boot keeps the real failure on screen and one tappable Copy diagnostics on top of it.
import { afterEach, expect, it, vi } from 'vitest';
import { showLoadFailure } from './errorScreen';
import { setDiagnosticsSource } from './diagnosticsCopy';
import type { LoadFailure } from '../core/errorReport';

// Each test leaves no 'online' listener behind: a screen no longer on the page drops its own on the next 'online', and the
// wait outlasts leaveAfterPaint's 100 ms timer, so no reload from this test lands in the next one.
afterEach(async () => {
  document.body.replaceChildren();
  window.dispatchEvent(new Event('online'));
  await new Promise(resolve => { setTimeout(resolve, 150); });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const failure: LoadFailure = { kind: 'load', context: {}, tags: {} as LoadFailure['tags'], name: 'Error', build: 'abc1234-test',
  stage: 'server', message: 'Standalone server worker failed to load', stack: 'Error: Standalone server worker failed to load\n  at boot' };

it('moves Copy diagnostics onto the fatal screen beside Reload and copies the card report', async () => {
  const card = document.createElement('div'); card.className = 'ws-load';
  const covered = document.createElement('button'); covered.className = 'ws-load-copy'; card.append(covered);
  document.body.append(card);
  setDiagnosticsSource(() => 'Wildshard boot diagnostics\ntimeline (LS1):\ncounts: 230 spans, 705 resources\nlongest spans: home 18.5 + 10.0');
  let copied = '';
  vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText: (text: string): Promise<void> => { copied = text; return Promise.resolve(); } } });
  const root = showLoadFailure(failure);
  const copies = document.querySelectorAll<HTMLButtonElement>('.ws-load-copy');
  expect(copies).toHaveLength(1);
  const copy = copies[0];
  if (copy === undefined) throw new Error('Missing Copy diagnostics');
  expect(root.contains(copy)).toBe(true);
  expect(root.querySelector('pre')?.textContent).toContain('failed to load');
  expect(copy.parentElement?.querySelector('button')?.textContent).not.toBe(copy.textContent);
  copy.click(); await Promise.resolve(); await Promise.resolve();
  expect(copied).toContain('timeline (LS1):');
  expect(copied).toContain('705 resources');
  expect(copied).not.toContain('"entries"');
  expect(copy.textContent).toBe('Copied');
});

// STAGING-BUGBASH SB53: offline mid load, a lazy module's fetch failed and this screen stayed after the network came back.
it('SB53: a load failure shown offline reloads this page once the network returns', () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload });
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => { run(0); return 0; });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  showLoadFailure({ ...failure, stage: 'level.play', message: 'Failed to fetch dynamically imported module: https://boot.test/b/c/late.js' });
  expect(reload).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('online'));
  return vi.waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
});

it('SB53: a load failure shown online waits for the player', async () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload });
  showLoadFailure(failure);
  window.dispatchEvent(new Event('online'));
  await new Promise(resolve => { setTimeout(resolve, 50); });
  expect(reload).not.toHaveBeenCalled();
});

it('SB53: only the screen on the page reloads when the network returns', async () => {
  const reload = vi.fn<() => void>();
  vi.stubGlobal('location', { href: 'https://boot.test/', origin: 'https://boot.test', pathname: '/', search: '', reload });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  // a second failure replaces the first screen: one reload, not one per screen ever shown
  showLoadFailure(failure);
  showLoadFailure({ ...failure, stage: 'level.play' });
  window.dispatchEvent(new Event('online'));
  await new Promise(resolve => { setTimeout(resolve, 250); });
  expect(reload).toHaveBeenCalledTimes(1);
  // a screen taken off the page leaves nothing listening
  reload.mockClear();
  showLoadFailure(failure).remove();
  window.dispatchEvent(new Event('online'));
  await new Promise(resolve => { setTimeout(resolve, 250); });
  expect(reload).not.toHaveBeenCalled();
});
