// @vitest-environment happy-dom
import { afterAll, afterEach, expect, test, vi } from 'vitest';

// the page scope is not disposed between tests: a closed one runs no timers, and leaveAfterPaint's frame wait lives on it
let owners: { dispose: () => void }[] = [];
afterEach(async () => {
  (await import('./reloadCover')).hideReloading();
  for (const owner of owners) owner.dispose();
  owners = [];
  document.body.replaceChildren(); Reflect.deleteProperty(window, '__ws_sw');
  Reflect.deleteProperty(navigator, 'onLine'); Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

/** Settings ▸ Build in a page running `running`, with the server's /version.json naming `live`. */
async function settingsBuild(running: string, live: string, where: 'title' | 'pause'): Promise<{
  row: HTMLElement; check: HTMLButtonElement; reload: HTMLButtonElement; status: () => string; fetches: string[];
  location: { reload: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> };
}> {
  vi.stubGlobal('__BUILD_ID__', running);
  const fetches: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => { fetches.push(`${url} ${init?.cache ?? ''}`); return Promise.resolve(Response.json({ build: live })); });
  const location = { reload: vi.fn(), replace: vi.fn() };
  vi.stubGlobal('location', Object.assign(new URL('https://example.com/?chunk=driftwood-isle'), location));
  document.body.innerHTML = where === 'title' ? '<div id="hud" class="intro"><div class="ws-main"></div></div>' : '<div id="hud"></div>';
  const { Scope } = await import('../../../shared/engine/app/scope');
  const { buildBuildRow } = await import('./buildRow');
  const owner = new Scope('build-row-test'); owners.push(owner);
  const row = buildBuildRow(owner);
  document.body.append(row);
  const check = row.querySelector('.ws-gmenu-buildcheck'), reload = row.querySelector('.ws-gmenu-buildreload');
  if (!(check instanceof HTMLButtonElement) || !(reload instanceof HTMLButtonElement)) throw new Error('Missing Build buttons');
  return { row, check, reload, status: () => row.querySelector('[role="status"]')?.textContent ?? '', fetches, location };
}
afterAll(async () => { (await import('../../../shared/engine/app/resources')).pageScope.dispose(); });
const tap = (button: HTMLElement): void => { button.dispatchEvent(new PointerEvent('pointerup', { button: 0 })); button.click(); };

test('R9: Settings ▸ Build shows the running build; Check reads /version.json and says the page is up to date', async () => {
  const { row, check, status, fetches } = await settingsBuild('40e08ff-1762700000', '40e08ff-1762700000', 'pause');
  expect(row.querySelector('.ws-gmenu-label')?.textContent).toBe('Build');
  expect(row.querySelector('.ws-gmenu-buildid')?.textContent).toBe('40e08ff');
  expect(status()).toBe('Running now');
  tap(check);
  expect(check.disabled).toBe(true); expect(status()).toBe('Checking…');
  await vi.waitFor(() => { expect(status()).toBe('Up to date'); });
  expect(fetches).toHaveLength(1); expect(fetches[0]).toMatch(/^\/version\.json\?t=\d+ no-store$/u);
  expect(check.disabled).toBe(false);
});

test('R9: a newer live build lights the row and its Reload, and Check announces it (ws-live-build) for the pill and the worker', async () => {
  const { row: box, check, reload, status } = await settingsBuild('40e08ff-1762700000', 'd91507e-1762800000', 'pause');
  const row = box.querySelector('.ws-gmenu-buildrow');
  const pill: (string | null)[] = [], { liveBuildOf } = await import('./buildCheck');
  window.addEventListener('ws-live-build', event => { pill.push(liveBuildOf(event)); });
  tap(check);
  await vi.waitFor(() => { expect(status()).toBe('New version d91507e · reload to switch'); });
  expect(row?.classList.contains('newer')).toBe(true); expect(reload.classList.contains('primary')).toBe(true);
  expect(pill).toEqual(['d91507e-1762800000']); // the announcement the pill (Update.ts) and the worker (sw.ts) listen for
});

test('R9 (R3 / R4): Reload in the pause menu answers in the tap\'s own turn with the loading button and the cover, then reloads in place', async () => {
  vi.useFakeTimers();
  const { reload, location } = await settingsBuild('40e08ff-1762700000', '40e08ff-1762700000', 'pause');
  tap(reload);
  // synchronous: no timer, no microtask has run since the tap
  expect(reload.disabled).toBe(true); expect(reload.getAttribute('aria-busy')).toBe('true'); expect(reload.textContent).toBe('Reloading');
  expect(document.getElementById('ws-reloading')?.textContent).toContain('Reloading');
  expect(location.reload).not.toHaveBeenCalled(); // one painted frame first (leaveAfterPaint)
  await vi.advanceTimersByTimeAsync(150);
  expect(location.reload).toHaveBeenCalledOnce(); expect(location.replace).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Confirm');
  tap(reload); await vi.advanceTimersByTimeAsync(150);
  expect(location.reload).toHaveBeenCalledOnce();
});

test('R9 (QC3 / RL5): on the title, Reload offers a waiting worker the 3 s budget; one it cannot adopt is a fresh title', async () => {
  vi.useFakeTimers();
  const adopt = vi.fn((_to?: string, _why?: string, _within?: number) => Promise.resolve(false));
  Object.defineProperty(window, '__ws_sw', { configurable: true, value: { waiting: { state: 'installed' }, adopt } });
  const { reload, status, location } = await settingsBuild('40e08ff-1762700000', 'd91507e-1762800000', 'title');
  expect(status()).toBe('New version · reload'); // the worker already holds a newer build
  tap(reload);
  expect(document.getElementById('ws-reloading')?.textContent).toContain('Switching to the new build');
  await vi.advanceTimersByTimeAsync(0);
  expect(adopt).toHaveBeenCalledExactlyOnceWith('/', 'settings build: reload at title', expect.any(Number));
  expect(adopt.mock.calls[0]?.[2]).toBeLessThanOrEqual(3000);
  await vi.advanceTimersByTimeAsync(150);
  expect(location.replace).toHaveBeenCalledExactlyOnceWith('/'); expect(location.reload).not.toHaveBeenCalled();
});

test('R9: offline, Check asks nothing and says it cannot check', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  const { check, status, fetches } = await settingsBuild('40e08ff-1762700000', 'd91507e-1762800000', 'pause');
  tap(check);
  await vi.waitFor(() => { expect(status()).toBe('Offline · can\'t check'); });
  expect(fetches).toEqual([]);
});

test('R9: a slow earlier read never takes back a newer one (the pill\'s and Check\'s reads share one order)', async () => {
  const { check, status } = await settingsBuild('40e08ff-1762700000', 'unused', 'pause');
  const answers: ((build: string) => void)[] = [];
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { answers.push(build => { resolve(Response.json({ build })); }); }));
  const { checkLiveBuild } = await import('./buildCheck');
  const announced: (string | null)[] = [], { liveBuildOf } = await import('./buildCheck');
  window.addEventListener('ws-live-build', event => { announced.push(liveBuildOf(event)); });
  const slow = checkLiveBuild(); // the pill's read, asked first
  tap(check); // Settings' Check, asked second
  await vi.waitFor(() => { expect(answers).toHaveLength(2); });
  answers[1]?.('d91507e-1762800000'); await vi.waitFor(() => { expect(status()).toBe('New version d91507e · reload to switch'); });
  answers[0]?.('40e08ff-1762700000'); await slow;
  expect(announced).toEqual(['d91507e-1762800000']); expect(status()).toBe('New version d91507e · reload to switch');
});
