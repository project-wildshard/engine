// Safari Remote Automation for an iPhone. This is a W3C client, not an inspector attachment.
// IP2. Match meta's phone_boot.py: fresh tab, wait for the origin on robots.txt,
// clear origin storage, seed and read back slots, then navigate to the zone.
// A fresh session alone does not clear caches. Safari's HTTP cache can carry.
// Build diagnostics and LAN reach are recorded per run, pending physical qualification.
// Screenshots are taken out of process by devicectl (record.mjs).
import { agentUrl } from '../../agent-marker.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { NAME_ASKED, writeSaveFixture } from '../../debug-settings.mjs';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export class WebDriverError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'WebDriverError';
    this.code = code;
  }
}

/** @typedef {(method: string, path: string, body?: unknown, timeout?: number) => Promise<any>} Request */
/** @typedef {{ [ELEMENT]: string }} Element */
/** @param {string} endpoint @returns {Request} */
export function webDriver(endpoint) {
  const address = new URL(endpoint);
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port ||
      address.username || address.password || address.pathname !== '/' || address.search || address.hash) {
    throw new Error('Safari WebDriver must use an http://127.0.0.1:PORT endpoint');
  }
  return async (method, path, body, timeout = 30_000) => {
    const headers = { 'Content-Type': 'application/json' };
    const signal = AbortSignal.timeout(timeout);
    const options = method === 'POST' ? { method, headers, signal, body: JSON.stringify(body) } : { method, headers, signal };
    const response = await fetch(new URL(path, address), options);
    const { value } = await response.json();
    if (!response.ok || value?.error) {
      throw new WebDriverError(value?.error ?? `HTTP ${response.status}`, value?.message ?? path);
    }
    return value;
  };
}

/** @param {Request} request @param {string} sessionId @param {boolean} owned */
function browser(request, sessionId, owned) {
  /** @type {Request} */
  const route = (method, path, body, timeout) =>
    request(method, `/session/${encodeURIComponent(sessionId)}${path}`, body, timeout);
  return {
    sessionId,
    getUrl: () => route('GET', '/url'),
    navigate: (/** @type {string} */ url) => route('POST', '/url', { url: agentUrl(url) }, 180_000),
    reload: () => route('POST', '/refresh', {}, 180_000),
    async freshTab() {
      const handles = await route('GET', '/window/handles');
      const { handle } = await route('POST', '/window/new', { type: 'tab' });
      for (const old of handles) {
        try {
          await route('POST', '/window', { handle: old });
          await route('DELETE', '/window');
        } catch (error) {
          if (!(error instanceof WebDriverError) || error.code !== 'no such window') throw error;
        }
      }
      await route('POST', '/window', { handle });
    },
    /** @param {string} script @param {unknown[]} [args] */
    evaluate: (script, args = []) => route('POST', '/execute/sync', { script, args }),
    /** @param {string} script @param {unknown[]} args @param {number} timeoutMs */
    async evaluateAsync(script, args, timeoutMs) {
      await route('POST', '/timeouts', { script: timeoutMs });
      return route('POST', '/execute/async', { script, args }, timeoutMs + 5_000);
    },
    click: (/** @type {Element} */ element) => route('POST', `/element/${encodeURIComponent(element[ELEMENT])}/click`, {}),
    close: () => owned ? route('DELETE', '') : Promise.resolve(),
  };
}

/** @typedef {ReturnType<typeof browser>} Safari */
/** @param {string} endpoint @param {string} sessionId */
export async function attachSafari(endpoint, sessionId) {
  if (!sessionId) throw new Error('a shared Safari session ID is required');
  const attached = browser(webDriver(endpoint), sessionId, false);
  await attached.getUrl();
  return attached;
}

/** @param {Request} request @param {string} udid */
async function openSession(request, udid) {
  const { sessionId } = await request('POST', '/session', { capabilities: { alwaysMatch: {
    platformName: 'iOS', browserName: 'Safari', 'safari:deviceUDID': udid,
  } } }, 60_000);
  return browser(request, sessionId, true);
}

/** Open one replacement session on an externally owned listener.
 * @param {string} endpoint @param {string} udid */
export function openSharedSafari(endpoint, udid) {
  return openSession(webDriver(endpoint), udid);
}

/** @param {string} udid */
export async function startSafari(udid) {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  await new Promise((resolve, reject) => {
    reservation.close((error) => { if (error) reject(error); else resolve(undefined); });
  });
  if (address === null || typeof address === 'string') throw new Error('could not reserve a Safari WebDriver port');
  const { port } = address;
  const driver = spawn('safaridriver', ['-p', String(port)], { stdio: 'ignore' });
  /** @type {Error | undefined} */
  let failed;
  async function waitForExit() {
    try { await once(driver, 'exit'); }
    catch (error) { failed = error instanceof Error ? error : new Error(String(error)); }
  }
  const exited = waitForExit();
  const request = webDriver(`http://127.0.0.1:${port}`);
  async function stop() {
    driver.kill();
    await exited;
  }
  try {
    const deadline = Date.now() + 10_000;
    for (;;) {
      if (failed) throw failed;
      if (driver.exitCode !== null || driver.signalCode !== null || Date.now() >= deadline) {
        throw new Error('owned safaridriver did not start');
      }
      const status = await request('GET', '/status', undefined, 1_000).catch(() => null);
      if (status?.ready) break;
      await pause(100);
    }
    return {
      open: () => openSession(request, udid),
      stop,
    };
  } catch (error) {
    await stop().catch(() => undefined);
    throw error;
  }
}

/** @param {Record<string, unknown>} overrides @param {boolean} developer */
export function phoneSlots(overrides = {}, developer = true) {
  // DW3 (mini-dw3): a `settings.<pick>` override is a global settings pick (`settings.time=midday`, `settings.weather=clear`:
  // the look loop's pinned clock and sky, so two boots of a look board light the same), merged with the tier and volume
  const picks = Object.fromEntries(Object.entries(overrides).filter(([key]) => key.startsWith('settings.')).map(([key, data]) => [key.slice('settings.'.length), data]));
  return [
    NAME_ASKED,
    { scope: 'device', key: 'firstPlayDone', data: true },
    ...(developer ? [{ scope: 'device', key: 'devMode', data: true }] : []),
    { scope: 'device', key: 'graphics', data: 'low' },
    { scope: 'global', key: 'settings', merge: true, data: { tier: 'phone', volume: 0, ...picks } },
    ...Object.entries(overrides).filter(([key]) => !key.startsWith('settings.')).map(([key, data]) => ({ scope: 'device', key, data })),
  ];
}

/** @param {Safari} driver @param {string} base */
async function waitForOrigin(driver, base) {
  const origin = new URL(base).origin;
  await driver.navigate(new URL('/robots.txt', base).href);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await driver.evaluate('return location.origin;') === origin) return origin;
    await pause(250);
  }
  throw new Error(`Safari did not reach ${origin} to read or seed storage`);
}

/** @param {Safari} driver @param {string} base @param {Record<string, unknown>} [slots] */
export async function coldOrigin(driver, base, slots = {}) {
  await driver.freshTab();
  const origin = await waitForOrigin(driver, base);
  const result = await driver.evaluateAsync(`
    const [origin, fixtures] = arguments, done = arguments[arguments.length - 1];
    const write = (${writeSaveFixture.toString()});
    (async () => {
      if (location.origin !== origin) throw new Error('Origin moved before slot seeding');
      localStorage.clear(); sessionStorage.clear();
      const workers = await navigator.serviceWorker?.getRegistrations() ?? [];
      await Promise.all(workers.map(worker => worker.unregister()));
      const entries = await globalThis.caches?.keys() ?? [];
      await Promise.all(entries.map(key => caches.delete(key)));
      const databases = await indexedDB.databases?.();
      await Promise.all((databases ?? []).filter(db => db.name).map(db => new Promise((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(db.name);
        deletion.onsuccess = resolve;
        deletion.onerror = () => reject(deletion.error);
        deletion.onblocked = () => reject(new Error('IndexedDB delete blocked: ' + db.name));
      })));
      const cache = { http: 'may carry', serviceWorkers: (await navigator.serviceWorker?.getRegistrations() ?? []).length,
        caches: (await globalThis.caches?.keys() ?? []).length,
        databases: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).length : null };
      if (cache.serviceWorkers || cache.caches || cache.databases) throw new Error('Origin storage was not cleared');
      for (const fixture of fixtures) write(fixture);
      const saved = fixtures.map(({ scope, key }) => ({
        scope, key, data: JSON.parse(localStorage.getItem('wildshard.save.v2@2.' + scope) ?? '{}').keys?.[key]?.data,
      }));
      for (const { scope, key, data, merge } of fixtures) {
        const value = saved.find(row => row.scope === scope && row.key === key)?.data;
        const verified = merge ? value && Object.entries(data).every(([key, expected]) => value[key] === expected)
          : JSON.stringify(value) === JSON.stringify(data);
        if (!verified) throw new Error('Slot readback failed: ' + key);
      }
      return { href: location.href, cache, saved };
    })().then(done, error => done({ error: String(error) }));
  `, [origin, phoneSlots(slots)], 45_000);
  if (result?.href === undefined) throw new Error(result?.error ?? 'Safari did not return slot readback');
  return result;
}

/** Read the surviving origin before a replacement trial clears it.
 * @param {Safari} driver @param {string} base @param {readonly string[]} keys */
export async function readRecovery(driver, base, keys) {
  const origin = await waitForOrigin(driver, base);
  return driver.evaluate(`
    if (location.origin !== arguments[0]) throw new Error('Origin moved before recovery read');
    const device = JSON.parse(localStorage.getItem('wildshard.save.v2@2.device') ?? '{}').keys ?? {};
    return {
      href: location.href,
      slots: Object.fromEntries(arguments[1].map(key => [key, device[key]?.data ?? null])),
      trace: device['boot.trace']?.data ?? null,
      abrupt: localStorage.getItem('boot.reports'),
      lastEnd: device['life.lastEnd']?.data ?? null,
    };
  `, [origin, keys]);
}

/** @param {Safari} driver @param {string[]} labels */
export function findButton(driver, labels) {
  return driver.evaluate(`
    const labels = arguments[0];
    for (const el of document.querySelectorAll('button, a, [role=button]')) {
      const label = (el.matches('.ws-menu-play') ? el.querySelector('b')?.textContent : el.innerText)?.trim().toLowerCase();
      if (labels.includes(label) && el.getClientRects().length && !el.disabled) return { el, label };
    }
    return null;
  `, [labels]);
}

// The same control predicate as benchmax. A loading canvas or 60 Hz rAF alone is no proof of play.
export const pageState = `
  const ws = window.__wildshard, w = ws?.world;
  const l = [...document.querySelectorAll('.ws-load')].reverse().find(el => el.querySelector('[data-el="suFact"]'));
  const shown = !!l && l.isConnected && l.getClientRects().length > 0 &&
    getComputedStyle(l).display !== 'none' && Number(getComputedStyle(l).opacity) > .05;
  let control = false;
  try { control = !!w?.hud.entered && !w.hud.paused && w.game.frameGate() && !shown; } catch {}
  const nav = performance.getEntriesByType('navigation')[0];
  const data = key => l?.querySelector('[data-el="' + key + '"]')?.textContent?.trim() ?? null;
  const rows = key => [...(l?.querySelector('[data-el="' + key + '"]')?.children ?? [])]
    .map(el => el.innerText?.trim() || el.textContent?.trim()).filter(Boolean);
  const failure = document.querySelector('.ws-load-error');
  return {
    control, visible: document.visibilityState === 'visible', href: location.href,
    text: (document.body?.innerText ?? '').trim().slice(0, 9000),
    reveal: window.__wsReveal ?? null, probe: ws ? Object.keys(ws) : null, userAgent: navigator.userAgent,
    build: window.__WS_BUILD_ID__ ?? null, version: window.__WS_BUILD_LABEL__ ?? null,
    timeOrigin: performance.timeOrigin,
    navigation: nav ? { load: nav.loadEventEnd, transferBytes: nav.transferSize } : null,
    phases: Object.fromEntries(['st','dl','su'].map(key => [key, {
      fact: data(key+'Fact'), pct: data(key+'Pct'), rows: rows(key+'Rows'),
    }])),
    phaseTimes: l ? {...l.dataset} : null,
    error: failure?.querySelectorAll('p')?.[1]?.textContent?.trim() || failure?.innerText?.trim() ||
      (l?.dataset.failed === 'true' ? data('foot') ?? 'Loading card is marked failed' : null),
    errorCard: failure?.innerText?.trim() || null,
    consoleErrors: window.__phoneBenchErrors ?? [],
  };
`;

/** @param {Safari} driver */
export async function watchPageErrors(driver) {
  await driver.evaluate(`
    if (!window.__phoneBenchErrors) {
      const errors = window.__phoneBenchErrors = [];
      const text = a => { if (!(a instanceof Error)) return String(a); let out = String(a.stack ? a + '\\n' + a.stack : a), c = a.cause;
        for (let depth = 0; c !== undefined && depth < 4; depth++, c = c?.cause) out += '\\ncause: ' + String(c instanceof Error && c.stack ? c + '\\n' + c.stack : c);
        return out; };
      const add = (kind, args) => { if (errors.length < 40) errors.push({kind, at: Math.round(performance.now()), message: args.map(text).join(' ')}); };
      const original = console.error;
      console.error = (...args) => { add('console', args); original.apply(console, args); };
      addEventListener('error', e => add('page', [e.message || '', e.error || '']));
      addEventListener('unhandledrejection', e => add('rejection', [e.reason]));
    }
  `);
}

/** @typedef {{ control: boolean, visible: boolean, href: string, text: string, reveal: unknown,
 * probe: string[] | null, userAgent: string, build: string | null, version: string | null, timeOrigin: number,
 * phases: Record<string,{ fact: string | null, pct: string | null, rows: string[] }>,
 * phaseTimes: Record<string,string> | null, error: string | null, errorCard: string | null,
 * consoleErrors: {kind:string, message:string}[],
 * navigation: { load: number, transferBytes: number } | null }} PageState */

/** @param {Safari} driver @param {number} startedAt @param {number} timeout
 * @param {(state: PageState) => void} observe @param {number} [reloadAt] */
export async function waitForControl(driver, startedAt, timeout, observe, reloadAt) {
  let state;
  let origin;
  let reloaded = false;
  let navigations = 0;
  let entered = startedAt;
  while (Date.now() - startedAt < timeout) {
    state = /** @type {PageState} */ (await driver.evaluate(pageState));
    observe(state);
    if (!state.visible) throw new Error('PHONE LOCKED: Safari page is not visible');
    if (state.timeOrigin !== origin) {
      if (origin !== undefined) navigations++;
      await watchPageErrors(driver);
      origin = state.timeOrigin;
    }
    const timing = { startedAt, state, reloaded, navigations };
    if (state.error) return { ...timing, outcome: 'error', controlAt: null };
    if (state.control) return { ...timing, outcome: 'control', controlAt: Date.now() };
    if (!reloaded && reloadAt !== undefined && Date.now() - startedAt >= reloadAt) {
      await driver.reload();
      reloaded = true;
    }
    const follow = await findButton(driver, reloaded ? ['skip', 'play anyway', 'enter zone', 'enter world', 'play'] : ['skip', 'play anyway']);
    if (follow) await driver.click(follow.el);
    // a tap before the menu's script bound its handlers does nothing (a cold Safari, 2026-11-19): ENTER ZONE still up
    // 6 s on means the first one missed
    if (!reloaded && Date.now() - entered >= 6_000) {
      entered = Date.now();
      const again = await findButton(driver, ['enter zone', 'enter world']);
      if (again) await driver.click(again.el);
    }
    await pause(500);
  }
  return { outcome: 'never-ready', startedAt, controlAt: null, state, reloaded, navigations };
}

/** @param {Safari} driver
 * @param {{base: string, slug: string, slots?: Record<string, unknown>, readyTimeout?: number, reloadAt?: number,
 * observe?: (state: PageState) => void, cacheOff?: boolean}} options */
export async function enterZone(driver, { base, slug, slots, readyTimeout = 240_000, reloadAt, observe = () => undefined, cacheOff = false }) {
  const origin = await coldOrigin(driver, base, slots);
  // DF8: a first load of a new build, as link-bench's cold runs boot (the inspector driver only)
  if (cacheOff) { const off = Reflect.get(driver, 'cacheOff'); if (typeof off === 'function') await off(true); }
  await driver.navigate(new URL(`/slug/${encodeURIComponent(slug)}`, base).href);
  const before = /** @type {PageState} */ (await driver.evaluate(pageState));
  observe(before);
  if (!before.visible) throw new Error('PHONE LOCKED: Safari page is not visible');
  await watchPageErrors(driver);
  const limit = Date.now() + readyTimeout;
  let entry;
  while (!(entry = await findButton(driver, ['enter zone', 'enter world', 'play']))) {
    const state = /** @type {PageState} */ (await driver.evaluate(pageState));
    if (state.error || /\bCOMING SOON\b/iu.test(state.text)) {
      observe(state);
      return { outcome: state.error ? 'error' : 'unavailable', startedAt: null, controlAt: null, state, origin, reloaded: false };
    }
    if (Date.now() >= limit) throw new Error('zone page did not expose ENTER ZONE');
    await pause(300);
  }
  const startedAt = Date.now();
  await driver.click(entry.el);
  return { ...(await waitForControl(driver, startedAt, readyTimeout, observe, reloadAt)), origin };
}
