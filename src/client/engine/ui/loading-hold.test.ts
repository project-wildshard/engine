// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { isDev, setDev } from '../core/devMode';
import { createSettings, getSetting, setSetting } from './Settings';
import { devSwitchRows } from './devSwitch';
import { Loading } from './Loading';

const owners: Scope[] = [];
let now = 100;
let previousDeveloper = false, previousHold = false;
beforeEach(() => {
  previousDeveloper = isDev(); previousHold = getSetting('holdLoading');
  setDev(false); setSetting('holdLoading', false);
  vi.useFakeTimers(); now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport in this completion regression */ }
    disconnect(): void { /* no observer work */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => {
  for (const owner of owners.splice(0)) owner.dispose();
  setSetting('holdLoading', previousHold); setDev(previousDeveloper);
  vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

function ready(scoped = false): Loading {
  const loading = new Loading({ id: 'hold-fixture', name: 'Completed world' }, { scoped });
  void loading.setDownloadSource({ready: Promise.resolve(), snapshot: () => ({totalBytes: 0, completedBytes: 0, cachedBytes: 0,
    filesTotal: 0, filesDone: 0, complete: true, error: null}), subscribe: listener => {listener(); return () => undefined;}});
  owners.push(loading.scope);
  loading.setPath({ id: scoped ? 'cell' : 'shardfile', steps: [{ key: 'modules', label: 'Modules', weight: 1 }] });
  loading.waiting('Preparing application services');
  now = 400;
  return loading;
}

it('offers the same Developer hold setting beneath the panel during loading', async () => {
  const loading = ready(), toggle = loading.root.querySelector<HTMLButtonElement>('.ws-load-hold');
  expect(toggle?.hidden).toBe(true);
  setDev(true); expect(toggle?.hidden).toBe(false);
  // G875: an on / off switch, its label and the pill loading.css draws as the track and knob
  expect(toggle?.getAttribute('role')).toBe('switch'); expect(toggle?.querySelector('.ws-gmenu-swlabel')?.textContent).toBe('Hold at loading screen');
  expect(toggle?.querySelector('.ws-gmenu-pill')).not.toBeNull();
  toggle?.click(); expect(getSetting('holdLoading')).toBe(true);
  expect(toggle?.getAttribute('aria-checked')).toBe('true');
  const finished = loading.done();
  expect(loading.root.dataset['hold']).toBe('true');
  toggle?.click(); await vi.advanceTimersByTimeAsync(1000); await finished;
  expect(getSetting('holdLoading')).toBe(false); expect(loading.scope.disposed).toBe(true);
});

it('defaults to auto-entry and persists the hold without a URL switch', () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string): string | null => stored.get(key) ?? null,
    setItem: (key: string, value: string): void => { stored.set(key, value); } };
  const first = createSettings(storage, () => '?holdLoading=1');
  expect(first.getSetting('holdLoading')).toBe(false);
  first.setSetting('holdLoading', true);
  expect(createSettings(storage, () => '').getSetting('holdLoading')).toBe(true);
});

it('shows the saved hold switch only under Developer and responds to an ordinary tap', () => {
  const scope = new Scope('loading-setting'); owners.push(scope);
  const rows = withOwner(scope, devSwitchRows);
  const hold = rows.find(row => row.textContent === 'Hold at loading screen');
  if (!(hold instanceof HTMLButtonElement)) throw new Error('Missing loading hold switch');
  document.body.append(...rows);
  expect(hold.hidden).toBe(true);
  setDev(true); expect(hold.hidden).toBe(false); expect(hold.getAttribute('aria-checked')).toBe('false');
  hold.click(); expect(getSetting('holdLoading')).toBe(true); expect(hold.getAttribute('aria-checked')).toBe('true');
  setDev(false); expect(hold.hidden).toBe(true); expect(getSetting('holdLoading')).toBe(true);
  hold.click(); expect(getSetting('holdLoading')).toBe(true);
});

it.each(['off', 'public', 'scoped'] as const)('keeps the original automatic fade for %s entry', async (mode) => {
  setDev(mode !== 'public'); setSetting('holdLoading', mode !== 'off');
  const loading = ready(mode === 'scoped'), finished = loading.done();
  expect(loading.holdRequested).toBe(false);
  expect(loading.root.querySelector('.ws-load-play')).toBeNull();
  await vi.advanceTimersByTimeAsync(320); await finished;
  expect(loading.scope.disposed).toBe(true);
});

it('holds complete bars and frozen timings until PLAY, then enters once after the fade', async () => {
  setDev(true); setSetting('holdLoading', true);
  const loading = ready(), enter = vi.fn();
  expect(loading.holdRequested).toBe(true);
  const finished = loading.done(); void finished.then(enter, () => undefined);
  expect(loading.done()).toBe(finished);
  const play = loading.root.querySelector<HTMLButtonElement>('.ws-load-play');
  if (play === null) throw new Error('Missing PLAY');
  expect(play.parentElement).toBe(loading.root);
  expect(play.nextElementSibling?.classList.contains('ws-load-foot')).toBe(true);
  expect(loading.root.querySelector<HTMLElement>('.ws-load-body')?.dataset['scroll']).toBe('true');
  expect(play.textContent).toBe('PLAY'); expect(document.activeElement).toBe(play);
  expect(loading.playRequested).toBe(false);
  expect(loading.root.dataset['download']).toBe('100'); expect(loading.root.dataset['setup']).toBe('100');
  const clock = loading.root.querySelector('[data-el="clock"]')?.textContent;
  const rows = loading.root.querySelector('[data-el="rows"]')?.innerHTML;
  now = 30_400; await vi.advanceTimersByTimeAsync(30_000);
  expect(enter).not.toHaveBeenCalled(); expect(loading.scope.disposed).toBe(false);
  expect(loading.root.classList.contains('hide')).toBe(false);
  expect(loading.root.querySelector('[data-el="clock"]')?.textContent).toBe(clock);
  expect(loading.root.querySelector('[data-el="rows"]')?.innerHTML).toBe(rows);
  play.click(); play.click(); await Promise.resolve();
  expect(loading.root.dataset['hold']).toBe('true');
  expect(loading.playRequested).toBe(true);
  expect(enter).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(320); await finished;
  expect(enter).toHaveBeenCalledTimes(1); expect(loading.scope.disposed).toBe(true);
});

it.each(['setting', 'developer'] as const)('releases a held completion when %s turns off', async (change) => {
  setDev(true); setSetting('holdLoading', true);
  const loading = ready(), finished = loading.done();
  if (change === 'setting') setSetting('holdLoading', false); else setDev(false);
  await vi.advanceTimersByTimeAsync(320); await finished;
  expect(loading.playRequested).toBe(false);
  expect(loading.scope.disposed).toBe(true);
});

it('does not enter a disposed load while waiting for PLAY', async () => {
  setDev(true); setSetting('holdLoading', true);
  const loading = ready(), enter = vi.fn(), refused = vi.fn();
  const finished = loading.done(), observed = finished.then(enter, refused);
  loading.scope.dispose(); await observed;
  expect(enter).not.toHaveBeenCalled(); expect(refused).toHaveBeenCalledTimes(1);
  expect(refused.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
});

it.each(['after tap', 'during fade'] as const)('does not enter a disposed load %s', async (when) => {
  setDev(true); setSetting('holdLoading', true);
  const loading = ready(), enter = vi.fn(), refused = vi.fn();
  const finished = loading.done(), observed = finished.then(enter, refused);
  loading.root.querySelector<HTMLButtonElement>('.ws-load-play')?.click();
  if (when === 'during fade') await vi.advanceTimersByTimeAsync(60);
  loading.scope.dispose(); await observed;
  expect(enter).not.toHaveBeenCalled(); expect(refused).toHaveBeenCalledTimes(1);
  expect(refused.mock.calls[0]?.[0]).toMatchObject({ name: 'AbortError' });
});
