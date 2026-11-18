// Meta STAGING-SMOKE SM1 (J398): the five kept scenarios of the "Game Right Now" audit, each a phone-sized headless browser
// driven through one player path. A scenario only observes: it returns what it saw (journey samples and the judge's
// problems, the probes' events, keyframes, the clip) and checks.mjs turns that into severities.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { judge, label, PHONE, screenNow, stickMoves } from '../journey-proof.mjs';
import { KEYCHAIN_ARGS } from '../chromium-keychain.mjs';
import { modalKind } from './checks.mjs';

/** @typedef {import('playwright').Page} Page */
/** @typedef {import('playwright').BrowserContext} BrowserContext */
/** @typedef {import('../journey-proof.mjs').Sample} Sample */
/** @typedef {import('../journey-proof.mjs').Problem} Problem */
/** @typedef {'chromium' | 'webkit'} BrowserName */
/** @typedef {'K1' | 'K2' | 'K3' | 'K4' | 'K5'} ScenarioId */
/** @typedef {{ kind: string, at: number, [key: string]: unknown }} ProbeEvent */
/** @typedef {{ name: string, at: number, samples: Sample[], problems: Problem[], path: string, tapAt: number, playAt: number | null, stick?: boolean, modals?: string[] }} Leg */
/** @typedef {{ build?: string, caches: string[], databases: string[], clientVersion?: string }} StorageState */
/**
 * What one scenario saw. `status: 'skip'` carries only `reason`.
 * @typedef {{
 *   id: ScenarioId, title: string, browser: BrowserName, status: 'ran' | 'skip' | 'crashed', reason?: string,
 *   seconds: number, legs: Leg[], errors: string[], events: ProbeEvent[], log: string[], frames: Record<string, string>,
 *   video?: string, settings?: { opened: boolean, closed: boolean }, quietTitle?: { drop: boolean, left: boolean }, drops?: number,
 *   oldCache?: { before: StorageState, after: StorageState, minClient?: string }, profile?: string, endState?: StorageState,
 * }} ScenarioResult
 */

/** The kept set (plan SM0), in run order: one browser at a time (SB31: two headless browsers at once fake a RECONNECTING strip). */
export const SCENARIOS = Object.freeze(/** @type {const} */ ([
  { id: 'K1', title: 'old cache (Chromium)', browser: 'chromium' },
  { id: 'K2', title: 'old cache (WebKit)', browser: 'webkit' },
  { id: 'K3', title: 'Driftwood chain (WebKit)', browser: 'webkit' },
  { id: 'K4', title: 'deep link (WebKit)', browser: 'webkit' },
  { id: 'K5', title: 'Infinite Wildshard (WebKit)', browser: 'webkit' },
]));

/** The six keyframes SM3 keeps per scenario, in contact-sheet order. */
export const KEYFRAMES = Object.freeze(['title', 'select', 'loading', 'play1', 'play10', 'last']);

/** Runs in the page before any of its scripts: a 60 fps requestAnimationFrame cap (the GPU is Jake's, lane rules), and
 * console lines for long tasks, WebSocket closes and the RECONNECTING strip, which the runner collects from every document. */
export function smokeProbes() {
  const say = (/** @type {Record<string, unknown>} */ row) => { console.debug(`__smoke ${JSON.stringify({ ...row, at: Date.now() })}`); };
  const native = window.requestAnimationFrame.bind(window);
  let gate = -1, next = 0;
  /* oxlint-disable promise/prefer-await-to-callbacks -- requestAnimationFrame's callbacks are the API being capped */
  // a deferred callback gets a new native id: keep the first id pointing at the live one, so cancelAnimationFrame still works
  const cancel = window.cancelAnimationFrame.bind(window);
  /** @type {Map<number, number>} */
  const live = new Map();
  let ids = 0;
  /** @param {number} id @param {FrameRequestCallback} cb @returns {FrameRequestCallback} */
  const track = (id, cb) => (t) => {
    if (t === gate || t >= next) { live.delete(id); if (t !== gate) { gate = t; next = t + 1000 / 61; } cb(t); } else live.set(id, native(track(id, cb)));
  };
  window.requestAnimationFrame = (cb) => { const id = ++ids; live.set(id, native(track(id, cb))); return id; };
  window.cancelAnimationFrame = (id) => { const n = live.get(id); if (n !== undefined) { cancel(n); live.delete(id); } };
  /* oxlint-enable promise/prefer-await-to-callbacks */
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration >= 200) say({ kind: 'longtask', ms: Math.round(e.duration) }); })
      .observe({ type: 'longtask', buffered: true });
  } catch {
    // WebKit has no longtask entries: a 100 ms heartbeat that wakes late names the same stall
    let beat = performance.now();
    setInterval(() => { const now = performance.now(), late = now - beat - 100; beat = now; if (late >= 200) say({ kind: 'longtask', ms: Math.round(late) }); }, 100);
  }
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    /** @param {string | URL} url @param {string | string[]} [protocols] */
    constructor(url, protocols) {
      super(url, protocols);
      this.addEventListener('close', (e) => { say({ kind: 'wsclose', code: e.code, reason: e.reason, url: String(url).replace(/\?.*$/u, '') }); });
    }
  };
  let shown = false;
  setInterval(() => {
    const strip = document.getElementById('ws-reconnect-strip');
    const now = strip !== null && !strip.hidden && strip.getBoundingClientRect().height > 0;
    if (now !== shown) { shown = now; say({ kind: 'strip', shown: now, text: (strip?.textContent ?? '').trim().slice(0, 80) }); }
  }, 100);
}

/** Runs in the page: what the J383 old-cache checks read. */
export async function storageState() {
  /** @type {StorageState} */
  const state = { caches: [], databases: [] };
  const build = Reflect.get(globalThis, '__WS_BUILD_ID__');
  if (typeof build === 'string') state.build = build;
  try { state.caches = await caches.keys(); } catch { /* no CacheStorage */ }
  try { state.databases = (await indexedDB.databases()).flatMap((row) => row.name === undefined ? [] : [row.name]); } catch { /* none */ }
  return state;
}

/** Selectors the scenarios tap. The main screen is changing (J387, J399): keep them here, in one place. */
export const SEL = Object.freeze({
  titleSelect: '.ws-main-select', settings: '.ws-main-settings:not(.ws-main-signin)', menuOpen: '.ws-gmenu.show', menuClose: '.ws-gmenu.show .ws-gmenu-close',
  pause: '.ws-touch-pause', exit: '.ws-gmenu.show .ws-gmenu-exit', dev: '.ws-main-dev', grid: '.ws-main-grid',
  play: '.ws-menu-play', skip: '#ws-name-box [data-name=skip]', drop: '#wsdrop', dropDismiss: '#wsdrop .dismiss',
});

/** Sample from `tap` until play has held for `holdMs` (or the budget runs out), saving keyframes on the way.
 * @param {Page} page @param {{ name: string, tap: () => Promise<void>, budgetMs?: number, holdMs?: number, shoot?: (name: string) => Promise<void>,
 *   allowTitleFirst?: boolean }} options @returns {Promise<Leg>} */
export async function watchLeg(page, { name, tap, budgetMs = 90_000, holdMs = 2000, shoot, allowTitleFirst = false }) {
  /** @type {Sample[]} */
  const samples = [];
  const start = Date.now();
  const sample = async () => {
    /** @type {import('../journey-proof.mjs').Screen | null} */
    let s = null;
    try { s = await page.evaluate(screenNow); } catch { /* the document is changing */ }
    samples.push({ t: Date.now() - start, s });
    return s;
  };
  await sample();
  await tap();
  /** @type {number | null} */
  let playAt = null, playSince = null;
  /** @type {string[]} */
  const modals = [];
  while (Date.now() - start < budgetMs) {
    const what = label(await sample());
    if (what === 'modal') {
      const kind = await page.evaluate(modalKind).catch(() => null);
      if (kind !== null && !modals.includes(kind)) modals.push(kind);
    }
    if (shoot !== undefined) {
      if (what === 'select') await shoot('select');
      if (what === 'loading') await shoot('loading');
    }
    if (what === 'play') {
      playAt ??= Date.now();
      playSince ??= Date.now();
      if (shoot !== undefined && Date.now() - playAt >= 1000) await shoot('play1');
      if (Date.now() - playSince > holdMs) break;
    } else playSince = null;
    await page.waitForTimeout(120);
  }
  // K5 (SM1): the grid card sits on the title, so the title before the first other screen is not a bounce
  const judged = allowTitleFirst ? dropLeadingTitle(samples) : samples;
  /** @type {string[]} */
  const path = [];
  for (const { t, s } of samples) { const l = label(s); if (!path.at(-1)?.endsWith(`:${l}`)) path.push(`${String(t)}:${l}`); }
  return { name, at: start, samples, problems: judge(judged, { budgetMs }), path: path.join(' '), tapAt: start, playAt, modals };
}

/** The samples from the first one that is not the title on, keeping the first sample's document as the tap's.
 * @param {readonly Sample[]} samples @returns {Sample[]} */
export function dropLeadingTitle(samples) {
  const first = samples.findIndex((row) => label(row.s) !== 'title' && label(row.s) !== 'navigating');
  if (first <= 0) return [...samples];
  const tapDoc = samples[0]?.s?.doc;
  const rest = samples.slice(first);
  const head = rest[0];
  return head === undefined || head.s === null || tapDoc === undefined ? rest : [{ t: head.t, s: { ...head.s, doc: tapDoc } }, ...rest.slice(1)];
}

/** Tap the title's Shard Select, skip the name prompt, pick `card`, and return the Enter World tap (journey-proof's tapJourney,
 * split so watchLeg can sample from the tap). `onDrop` hears every drop note dismissed on the way (SB30).
 * @param {Page} page @param {string} card @param {() => void} [onDrop] @returns {Promise<() => Promise<void>>} */
export async function toShardSelect(page, card, onDrop = () => undefined) {
  const clear = async () => { if (await clearDrop(page)) onDrop(); };
  await page.locator(SEL.titleSelect).waitFor({ state: 'visible', timeout: 60_000 });
  await clear();
  await page.locator(SEL.titleSelect).tap();
  await page.locator('#ws-name-box, .ws-title-stack[data-screen="select"]').first().waitFor({ timeout: 15_000 });
  if (await page.locator(SEL.skip).isVisible()) await page.locator(SEL.skip).tap();
  await clear();
  await page.locator('.ws-title-stack[data-screen="select"]').waitFor({ timeout: 15_000 });
  /** @type {unknown} */
  const rows = JSON.parse((await page.locator('#ws-title-rows').textContent()) ?? '[]');
  const row = Array.isArray(rows) ? rows.find((r) => typeof r === 'object' && r !== null && (r.slug === card || r.name === card)) : undefined;
  if (row === undefined) throw new Error(`No title row ${card}`);
  const names = await page.locator('.ws-menu-card b').allTextContents();
  const index = names.findIndex((n) => n.toLowerCase() === String(row.name).toLowerCase());
  if (index === -1) throw new Error(`No Shard Select card for ${String(row.name)}`);
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).tap();
  await page.locator(`.ws-menu-card.selected[data-i="${String(index)}"]`).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  return async () => { await clear(); await page.locator(SEL.play).tap(); };
}

/** A drop note from the page before is the title's own modal (journey-proof): dismiss it, and say whether one was there.
 * @param {Page} page @returns {Promise<boolean>} */
export async function clearDrop(page) {
  await page.waitForTimeout(300);
  const dismiss = page.locator(SEL.dropDismiss);
  if (!(await dismiss.isVisible())) return false;
  await dismiss.tap();
  return true;
}

/** An old profile can recover its previous world (SR4) instead of opening the title. Acknowledge its notice and use the
 * player's pause/exit controls; keep the drop in the result and leave all old-cache checks intact.
 * @param {Page} page @param {{onDrop?: () => void, onRecovery?: () => Promise<void>}} [options] */
export async function oldProfileTitle(page, { onDrop = () => undefined, onRecovery = () => Promise.resolve() } = {}) {
  const back = '.ws-title-stack[data-screen="select"] .ws-menu-back';
  const controls = [SEL.dropDismiss, back, SEL.exit, SEL.pause, SEL.titleSelect];
  let recovered = false;
  /** @type {{ selector: string, document: number } | undefined} */
  let previous;
  for (let step = 0; step < 8; step++) {
    // Wait for the previous tap to change the actionable control or document. Exit can stay visible while it saves.
    const ready = await page.waitForFunction(({ selectors, previous: previousTarget }) => {
      const selector = selectors.find((candidate) => [...document.querySelectorAll(candidate)].some((element) => {
        if (element.closest('[inert]') !== null || element.matches(':disabled')) return false;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden') return false;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit !== null && element.contains(hit);
      }));
      const origin = performance.timeOrigin;
      return selector !== undefined && (previousTarget === undefined || selector !== previousTarget.selector || origin !== previousTarget.document)
        ? { selector, document: origin } : false;
    }, { selectors: controls, previous }, { timeout: 90_000 });
    const target = await ready.jsonValue();
    await ready.dispose();
    if (target === false) throw new Error('Old profile has no actionable title control');
    const { selector } = target;
    if (selector === SEL.titleSelect) return;
    if (!recovered && [SEL.dropDismiss, SEL.pause, SEL.exit].includes(selector)) {
      recovered = true;
      await onRecovery();
      continue; // a recovery capture can cross a transition; choose the current hit target again
    }
    try {
      if (selector === SEL.dropDismiss) { if (await clearDrop(page)) onDrop(); }
      else await page.locator(selector).tap({ timeout: 5000 });
      previous = target;
    } catch (error) {
      // If navigation took the tapped control away, choose again on the new document. A stuck control still fails.
      const navigated = await page.waitForFunction(origin => performance.timeOrigin !== origin, target.document, { timeout: 2000 })
        .then(async handle => { await handle.dispose(); return true; }, () => false);
      if (!navigated) throw error;
    }
  }
  throw new Error('Old profile did not return to title through its controls');
}

/**
 * One scenario, start to finish, in its own persistent profile.
 * @param {{ id: ScenarioId, title: string, browser: BrowserName }} scenario
 * @param {{ url: string, out: string, card: string, deepLink: string, oldProfile?: string, oldState?: StorageState, minClient?: string,
 *   watchMs?: number, budgetMs?: number, candidateBuild?: string, pw: typeof import('playwright') }} options
 * K1 and K2 with no saved profile seed one (a fresh profile played into Driftwood) and report SKIP: there is no old cache yet.
 * @returns {Promise<ScenarioResult>}
 */
export async function runScenario(scenario, { url, out, card, deepLink, oldProfile, oldState, minClient, watchMs, budgetMs = 90_000, candidateBuild, pw }) {
  const dir = join(out, scenario.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'frames'), { recursive: true });
  /** @type {ScenarioResult} */
  const result = { ...scenario, status: 'ran', seconds: 0, legs: [], errors: [], events: [], log: [], frames: {}, drops: 0 };
  const onDrop = () => { result.drops = (result.drops ?? 0) + 1; };
  const old = scenario.id === 'K1' || scenario.id === 'K2';
  const started = Date.now();
  const say = (/** @type {string} */ line) => { result.log.push(`${((Date.now() - started) / 1000).toFixed(1)}s ${line}`); };
  const profile = join(dir, 'profile');
  if (oldProfile !== undefined) cpSync(oldProfile, profile, { recursive: true });
  const engine = scenario.browser === 'webkit' ? pw.webkit : pw.chromium;
  const context = await engine.launchPersistentContext(profile, {
    ...PHONE, isMobile: scenario.browser !== 'webkit', headless: true,
    recordVideo: { dir: join(dir, 'video'), size: PHONE.viewport },
    ...(scenario.browser === 'webkit' ? {} : { args: [...KEYCHAIN_ARGS, '--use-angle=metal'] }),
  });
  // only GETs leave the page, as in journey-proof.mjs
  await context.route('**/*', async (route) => { await (route.request().method() === 'GET' ? route.continue() : route.abort()); });
  await context.addInitScript(smokeProbes);
  const page = context.pages()[0] ?? await context.newPage();
  /** @param {Page} p */
  const watch = (p) => {
    p.on('pageerror', (e) => { result.errors.push(e.message); say(`pageerror ${e.message.slice(0, 120)}`); });
    p.on('console', (m) => {
      const text = m.text();
      if (!text.startsWith('__smoke ')) return;
      try { result.events.push(JSON.parse(text.slice(8))); } catch { /* not ours */ }
    });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) say(`nav ${f.url()}`); });
  };
  watch(page);
  /** @param {string} name */
  const shoot = async (name) => {
    if (result.frames[name] !== undefined && name !== 'last') return;
    const path = join(dir, 'frames', `${name}.jpg`);
    try { await page.screenshot({ path, type: 'jpeg', quality: 75, scale: 'css', timeout: 5000 }); result.frames[name] = path; } catch { /* a navigation ate it */ }
  };
  /** Watch play for `ms` (strip, long tasks), then the +10 s keyframe. @param {Leg} leg @param {number} ms */
  const hold = async (leg, ms) => {
    if (leg.playAt === null) return;
    const until = leg.playAt + ms;
    const ten = leg.playAt + 10_000;
    if (Date.now() < ten) await page.waitForTimeout(ten - Date.now());
    await shoot('play10');
    if (Date.now() < until) await page.waitForTimeout(until - Date.now());
  };
  try {
    const open = async (/** @type {string} */ path) => {
      await page.goto(`${url}${path}`, { waitUntil: 'commit', timeout: 60_000 }).catch((/** @type {unknown} */ e) => { if (!String(e).includes('interrupted')) throw e; });
    };
    if (old) {
      await open('/');
      // an old shell may reload itself (J383's wipe, or the worker's update): wait for the candidate, then the title
      if (candidateBuild !== undefined) {
        await page.waitForFunction((b) => Reflect.get(globalThis, '__WS_BUILD_ID__') === b, candidateBuild, { timeout: 20_000 }).catch(() => undefined);
      }
      await oldProfileTitle(page, { onDrop, onRecovery: async () => { say('old cache recovery notice or resumed world; use real controls to title'); await shoot('recovery'); } });
      const after = await page.evaluate(storageState);
      if (oldProfile !== undefined) {
        result.oldCache = { before: oldState ?? { caches: [], databases: [] }, after, ...(minClient === undefined ? {} : { minClient }) };
        say(`old cache: page ${after.build?.slice(0, 8) ?? '?'}, caches ${after.caches.join(' ')}, databases ${after.databases.join(' ')}`);
      } else say('no saved profile: seeding one for the next release');
      await shoot('title');
      const leg = await watchLeg(page, { name: 'journey', tap: await toShardSelect(page, card, onDrop), shoot, budgetMs });
      leg.stick = leg.playAt !== null && leg.problems.length === 0 ? await stickMoves(page) : undefined;
      result.legs.push(leg);
      await hold(leg, watchMs ?? 10_000);
      // SM4: left in Driftwood, as Jake's phone is left; what it holds is the next release's "before"
      result.endState = await page.evaluate(storageState);
      if (oldProfile === undefined) { result.status = 'skip'; result.reason = `no saved ${scenario.browser} profile for ${url} yet: seeded one for the next release`; }
    } else if (scenario.id === 'K3') {
      await open('/');
      await page.locator(SEL.titleSelect).waitFor({ state: 'visible', timeout: 60_000 });
      await shoot('title');
      // title SETTINGS (SB27): opens the sheet, and its CLOSE puts the title back
      const opened = await page.locator(SEL.settings).first().tap().then(() => page.locator(SEL.menuOpen).waitFor({ timeout: 8000 })).then(() => true, () => false);
      let closed = false;
      if (opened) {
        await page.locator(SEL.menuClose).tap().catch(() => undefined);
        closed = await page.locator(SEL.menuOpen).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false)
          || await page.locator(SEL.menuOpen).waitFor({ state: 'hidden', timeout: 1000 }).then(() => true, () => false);
      }
      result.settings = { opened, closed };
      say(`title SETTINGS opened ${String(opened)}, closed ${String(closed)}`);
      const cold = await watchLeg(page, { name: 'cold', tap: await toShardSelect(page, card), shoot, budgetMs });
      cold.stick = cold.playAt !== null && cold.problems.length === 0 ? await stickMoves(page) : undefined;
      result.legs.push(cold);
      say(`cold: ${cold.path}`);
      // pause, EXIT TO MAIN MENU, a quiet title (no drop modal, SB8), re-enter in the same tab
      if (cold.playAt !== null) {
        await page.locator(SEL.pause).tap();
        await page.locator(SEL.exit).tap();
        await page.locator(SEL.titleSelect).waitFor({ state: 'visible', timeout: 30_000 });
        let drop = false, left = false;
        for (let i = 0; i < 20; i++) {
          const s = await page.evaluate(screenNow).catch(() => null);
          if (s?.modal === true) drop = true;
          if (s !== null && !s.title) left = true;
          await page.waitForTimeout(150);
        }
        result.quietTitle = { drop, left };
        say(`back at title: drop ${String(drop)}, left ${String(left)}`);
        const again = await watchLeg(page, { name: 're-enter', tap: await toShardSelect(page, card), budgetMs });
        result.legs.push(again);
        say(`re-enter: ${again.path}`);
      }
      // close and reopen warm: the worker in control
      await page.goto('about:blank');
      await open('/');
      const warm = await watchLeg(page, { name: 'warm', tap: await toShardSelect(page, card), budgetMs });
      result.legs.push(warm);
      say(`warm: ${warm.path}`);
      await hold(warm, watchMs ?? 10_000);
    } else if (scenario.id === 'K4') {
      await open(`/slug/${deepLink}`);
      await page.locator(SEL.play).waitFor({ state: 'visible', timeout: 60_000 });
      await shoot('title');
      const leg = await watchLeg(page, { name: 'deep link', shoot, budgetMs, tap: async () => {
        await page.locator(SEL.play).tap();
        await page.locator(SEL.skip).waitFor({ state: 'visible', timeout: 4000 }).then(() => page.locator(SEL.skip).tap(), () => undefined);
      } });
      leg.stick = leg.playAt !== null && leg.problems.length === 0 ? await stickMoves(page) : undefined;
      result.legs.push(leg);
      say(`deep link: ${leg.path}`);
      await hold(leg, watchMs ?? 30_000);
    } else {
      await open('/');
      await page.locator(SEL.titleSelect).waitFor({ state: 'visible', timeout: 60_000 });
      const dev = page.locator(SEL.dev).first();
      if (await dev.isVisible() && (await dev.getAttribute('aria-checked')) !== 'true') { await dev.tap(); say('Developer switch on (Infinite Wildshard is Developer-only until SF22)'); }
      const grid = page.locator(SEL.grid).first();
      if (!(await grid.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false))) {
        await context.close().catch(() => undefined);
        return { ...result, status: 'skip', reason: 'no Infinite Wildshard card on this build', seconds: (Date.now() - started) / 1000 };
      }
      await shoot('title');
      const leg = await watchLeg(page, { name: 'grid', allowTitleFirst: true, shoot, budgetMs, tap: async () => {
        await grid.tap();
        await page.locator(SEL.skip).waitFor({ state: 'visible', timeout: 4000 }).then(() => page.locator(SEL.skip).tap(), () => undefined);
      } });
      leg.stick = leg.playAt !== null && leg.problems.length === 0 ? await stickMoves(page) : undefined;
      result.legs.push(leg);
      say(`grid: ${leg.path}`);
      await hold(leg, watchMs ?? 10_000);
    }
    await shoot('last');
  } catch (error) {
    result.status = 'crashed';
    result.reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    say(`crashed: ${result.reason ?? ''}`);
    await shoot('last');
  } finally {
    const video = page.video();
    await context.close().catch(() => undefined);
    result.seconds = (Date.now() - started) / 1000;
    const webm = await video?.path().catch(() => undefined);
    if (webm !== undefined && existsSync(webm)) result.video = toMp4(webm, join(dir, `${scenario.id}.mp4`));
    rmSync(join(dir, 'video'), { recursive: true, force: true });
    // K1 and K2 keep their profile for SM4; the rest are throwaway
    if (old) result.profile = profile; else rmSync(profile, { recursive: true, force: true });
  }
  return result;
}

/** The recorded clip as an .mp4 (H.264, 15 fps), or the .webm when ffmpeg is missing.
 * @param {string} webm @param {string} mp4 @returns {string} */
export function toMp4(webm, mp4) {
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-r', '15', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4], { stdio: 'ignore' });
    return mp4;
  } catch {
    const kept = mp4.replace(/\.mp4$/u, '.webm');
    renameSync(webm, kept);
    return kept;
  }
}

/** Every file in `dir` (one level), for tests. @param {string} dir @returns {string[]} */
export const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
