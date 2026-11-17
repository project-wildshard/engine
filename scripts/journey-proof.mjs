#!/usr/bin/env node
// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386): the player's own way into a world, tapped on a phone, judged frame by frame.
// The only screens allowed are the main menu, Zone select, the world's full-screen detailed loading card and play.
// MAIN-SCREEN MS5 (J399): three ways in, each judged the same: ZONE SELECT, a card, ENTER ZONE (`select`); ENTER THE MMO
// (`mmo`); the one-zone deep link `/slug/<card>`, ENTER ZONE (`deeplink`). "It has to always be the detailed loading card". A bounce back to a
// menu, the bare launch shell on a world page, the HUD over a menu, a loading card shrunk to a bar or a blank wait fails.
//
//   node scripts/journey-proof.mjs --url https://staging.wildshard.io --card driftwood-isle [--browsers chromium,webkit] [--paths select,mmo,deeplink] [--developer]
//        [--runs cold,warm] [--throttle 4] [--prime <profiles dir>] [--out tmp/<lane>/journey] [--video]
//
// The T1 spec (src/e2e/t1/journey.spec.ts) drives the same `tapJourney` against the local build; this CLI is the release
// staging gate (J386), run before any prod promote. It only reads: every request but a GET is aborted.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { watchFaults } from './proof-faults.mjs';

/** @typedef {import('playwright').Page} Page */
/** @typedef {{ doc: number|string, path: string, shell: boolean, title: boolean, select: boolean, loading: boolean, bar: boolean, hud: boolean, modal: boolean, reveal?: boolean, origin?: number, detailed?: boolean, zone?: string }} Screen */
/** @typedef {'select' | 'mmo' | 'deeplink'} JourneyPath */
/** @typedef {{ t: number, s: Screen | null }} Sample */
/** @typedef {{ at: number, text: string }} Problem */

/** iPhone 17 Pro portrait, as Jake holds it. */
export const PHONE = Object.freeze({
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
});

/** Runs in the page: what the player sees right now. No app probes; a private document identity distinguishes actual navigation from clock rounding.
 * @returns {Screen} */
export function screenNow() {
  // A rounded clock is not a document identity. A replacement document gets a new token even if its rounded origin matches.
  const key = Symbol.for('wildshard.journey.document'), held = Reflect.get(document, key);
  const doc = typeof held === 'string' ? held : crypto.randomUUID();
  if (held === undefined) Object.defineProperty(document, key, { value: doc });
  /** @param {Element} el */
  const seen = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4 || rect.bottom <= 0 || rect.top >= innerHeight) return false;
    for (let node = /** @type {Element | null} */ (el); node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false;
      if (node !== el && node.classList.contains('hide')) return false;
    }
    return true;
  };
  /** @param {string} selector */
  const shown = (selector) => [...document.querySelectorAll(selector)].some(seen);
  const load = [...document.querySelectorAll('.ws-load:not(.hide)')].find(seen);
  const loadHeight = load === undefined ? 0 : load.getBoundingClientRect().height;
  return {
    doc, origin: performance.timeOrigin, path: location.pathname + location.search,
    shell: shown('[data-title-shell]'), title: shown('.ws-main:not(.hide)'), select: shown('.ws-menu:not(.hide)'),
    loading: load !== undefined && loadHeight >= innerHeight * 0.8, bar: load !== undefined && loadHeight < innerHeight * 0.8,
    // J399: the detailed card, its START, DOWNLOAD and LOAD tracks on screen, never a plain one-bar card; and the zone it names
    detailed: load !== undefined && ['stHead', 'dlHead', 'suHead'].every((track) => [...load.querySelectorAll(`[data-el="${track}"]`)].some(seen)),
    zone: load?.querySelector('[data-el="slug"]')?.textContent ?? '',
    hud: shown('.ws-touch') || shown('.ws-minimap'), modal: shown('#wsdrop, #wserr, .ws-fail'),
    // the grid's sky-down arrival (grid/reveal.ts): the world drawn under its ARRIVING caption, the HUD held back for 3 s
    reveal: shown('.ws-grid-reveal'),
  };
}

/** One label per sample.
 * @param {Screen | null} s @returns {string} */
export function label(s) {
  if (s === null) return 'navigating';
  if (s.modal) return 'modal';
  if (s.shell) return 'shell';
  if (s.title) return 'title';
  if (s.select) return 'select';
  if (s.loading) return 'loading';
  if (s.bar) return 'bar';
  if (s.hud) return 'play';
  if (s.reveal === true) return 'arrival';
  return 'blank';
}

/** The verdict on samples taken from the Enter World tap on: every way this journey has broken on a phone.
 * @param {readonly Sample[]} samples @param {{ blankMs?: number, budgetMs?: number }} [options] @returns {Problem[]} */
// blankMs (STAGING-BUGBASH SB5): no blank wait past half a second. The grid's sky-down arrival is its own screen ('arrival');
// the loading card leaves a still copy over a canvas the reveal still hides (ui/Loading.ts `holdLoadingVeil`). The loops this
// guards held a blank screen for 5 to 30 s.
export function judge(samples, { blankMs = 500, budgetMs = 90_000 } = {}) {
  /** @type {Problem[]} */
  const problems = [];
  const tapDoc = samples[0]?.s?.doc;
  /** @type {number | null} */
  let blankFrom = null;
  let played = false;
  // ENTER THE MMO is tapped on the main menu, so the first samples may show it; once anything else shows, it never comes back
  let left = false;
  /** @param {number} at @param {string} text */
  const say = (at, text) => { if (!problems.some((p) => p.text === text)) problems.push({ at, text }); };
  for (const { t, s } of samples) {
    const what = label(s), later = s !== null && s.doc !== tapDoc;
    if (s !== null && s.hud && (s.title || s.select || s.shell)) say(t, 'the in-game HUD is drawn over a menu');
    if (what === 'shell') say(t, 'the bare launch shell (lone SHARD SELECT, LOADING) shows on the world page');
    // ENTER THE MMO's card paints over the main menu, which stays laid out under it until the page leaves: a card on screen is
    // not the menu coming back, and from it on the menu alone is
    const card = s?.loading === true || s?.bar === true;
    if (what === 'title' && !card && (left || later)) say(t, 'the main menu came back after Enter World');
    if ((what !== 'title' && what !== 'navigating') || card) left = true;
    if (what === 'select' && later) say(t, 'Shard Select came back after Enter World');
    if (s?.bar === true) say(t, 'the loading card is shrunk to a bar');
    // any full-screen card on screen, whatever sits under it (the deck stays laid out beneath the card until the page leaves)
    if (s?.loading === true && s.detailed === false) say(t, 'the loading card is not the detailed one (J399)');
    if (what === 'modal') say(t, 'an error or drop modal opened');
    if (what === 'blank' || (what === 'navigating' && later)) {
      blankFrom ??= t;
      if (t - blankFrom > blankMs) say(blankFrom, `a blank screen for over ${String(blankMs)} ms`);
    } else blankFrom = null;
    if (what === 'play') played = true;
  }
  if (!played) say(samples.at(-1)?.t ?? 0, `never reached play within ${String(budgetMs)} ms`);
  return problems;
}

/** The index of `card`'s Shard Select card among the cards' `<b>` names, or -1. SHARD-SOURCE SS-JP1 (F17): a shard the API placed
 * after the build has no row in `#ws-title-rows` (its card comes from the catalogue, SA46), so the name tried is the title row's
 * (by slug or name), else `card` itself, else `card` with dashes as spaces (`mirror-salt` → `Mirror Salt`), compared lower-case.
 * @param {unknown} rows the page's `#ws-title-rows` @param {readonly string[]} names @param {string} card a slug or a name */
/** How long the select waits for an uploaded shard's card: the placement file's 3 s deadline, carding and slack. */
const CARD_WAIT_MS = 10_000;
export function titleCardIndex(rows, names, card) {
  const row = Array.isArray(rows) ? rows.find((r) => typeof r === 'object' && r !== null && (r.slug === card || r.name === card)) : undefined;
  const lower = names.map((n) => n.trim().toLowerCase());
  for (const name of [row?.name, card, card.replaceAll(/[-_]+/gu, ' ')]) {
    if (typeof name !== 'string') continue;
    const index = lower.indexOf(name.trim().toLowerCase());
    if (index !== -1) return index;
  }
  return -1;
}

/** Tap one way into a world and sample until play holds for 2 s. `select` (the default): the title's ZONE SELECT, pick `card`
 * by slug or name, ENTER ZONE. `mmo`: the title's ENTER THE MMO. `deeplink`: the page is already on `/slug/<card>`, ENTER ZONE.
 * @param {Page} page @param {{ card: string, path?: JourneyPath, budgetMs?: number, sampleMs?: number, frames?: (row: Sample) => Promise<void> }} options
 * @returns {Promise<Sample[]>} */
export async function tapJourney(page, { card, path = 'select', budgetMs = 90_000, sampleMs = 120, frames }) {
  // A drop note from the page before (a crash, an unmarked leave) is the title's own modal: dismiss it before every tap.
  const clear = async () => {
    await page.waitForTimeout(300);
    const dismiss = page.locator('#wsdrop .dismiss');
    if (await dismiss.isVisible()) await dismiss.tap();
  };
  /** @type {Sample[]} */
  const samples = [];
  const start = Date.now();
  const sample = async () => {
    /** @type {Screen | null} */
    let s = null;
    try { s = await page.evaluate(screenNow); } catch { /* the document is changing */ }
    samples.push({ t: Date.now() - start, s });
    return s;
  };
  const skipName = async () => {
    const skip = page.locator('#ws-name-box [data-name=skip]');
    if (await skip.isVisible()) await skip.tap();
  };
  if (path !== 'select') {
    const go = page.locator(path === 'mmo' ? '.ws-main-mmo' : '.ws-slug .ws-menu-play');
    await go.waitFor({ state: 'visible', timeout: 60_000 });
    await clear();
    await sample();
    await go.tap();
    // a first play asks the Name once (MP2.4); SKIP goes on into the world
    await page.locator('#ws-name-box').waitFor({ timeout: 1500 }).then(skipName, () => undefined);
    return sampleToPlay(page, { budgetMs, sampleMs, frames, samples, sample, start });
  }
  const selectCard = page.locator('.ws-main-select');
  await selectCard.waitFor({ state: 'visible', timeout: 60_000 });
  await clear();
  await selectCard.tap();
  await page.locator('#ws-name-box, .ws-title-stack[data-screen="select"]').first().waitFor({ timeout: 15_000 });
  await skipName();
  await clear();
  await page.locator('.ws-title-stack[data-screen="select"]').waitFor({ timeout: 15_000 });
  // an upload's card (Glowfen, Mirror Salt) joins the open select once the placement file answers (3 s deadline) and its catalogue
  // card is read: wait for it as a player would, rather than reading the build's cards alone (SHARD-SOURCE SS14e)
  let index = -1, names = /** @type {string[]} */ ([]);
  const until = Date.now() + CARD_WAIT_MS;
  for (;;) {
    /** @type {unknown} */
    const rows = JSON.parse((await page.locator('#ws-title-rows').textContent()) ?? '[]');
    names = await page.locator('.ws-menu-card b').allTextContents();
    index = titleCardIndex(rows, names, card);
    if (index !== -1 || Date.now() >= until) break;
    await page.waitForTimeout(250);
  }
  if (index === -1) throw new Error(`No Shard Select card for ${card} after ${String(CARD_WAIT_MS / 1000)} s (cards: ${names.join(', ')})`);
  await clear();
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).tap();
  await page.locator(`.ws-menu-card.selected[data-i="${String(index)}"]`).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await clear();
  await sample();
  await page.locator('.ws-menu-play').tap();
  return sampleToPlay(page, { budgetMs, sampleMs, frames, samples, sample, start });
}

/** Sample from the tap until play holds for 2 s, or the budget runs out.
 * @param {Page} page @param {{ budgetMs: number, sampleMs: number, frames?: (row: Sample) => Promise<void>, samples: Sample[], sample: () => Promise<Screen | null>, start: number }} run
 * @returns {Promise<Sample[]>} */
async function sampleToPlay(page, { budgetMs, sampleMs, frames, samples, sample, start }) {
  /** @type {number | null} */
  let playSince = null;
  let shotAt = -1e9;
  while (Date.now() - start < budgetMs) {
    const s = await sample();
    const last = samples.at(-1);
    if (frames !== undefined && last !== undefined && Date.now() - shotAt > 450) { shotAt = Date.now(); await frames(last).catch(() => undefined); }
    if (label(s) === 'play') {
      playSince ??= Date.now();
      if (Date.now() - playSince > 2000) break;
    } else playSince = null;
    await page.waitForTimeout(sampleMs);
  }
  return samples;
}

/** Real movement on any build: hold the move stick up for 1.2 s and see the world's pixels change.
 * @param {Page} page @returns {Promise<boolean>} */
export async function stickMoves(page) {
  const box = await page.locator('.ws-touch-stick').boundingBox();
  if (box === null) return false;
  const clip = { x: 0, y: 120, width: 402, height: 420 };
  const before = await page.screenshot({ clip });
  await page.evaluate(async ({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (el === null) return;
    /** @param {number} dy */
    const touch = (dy) => new Touch({ identifier: 7, target: el, clientX: x, clientY: y - dy });
    /** @param {string} type @param {number} dy */
    const fire = (type, dy) => {
      try {
        const live = type === 'touchend' ? [] : [touch(dy)];
        el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: live, changedTouches: [touch(dy)], targetTouches: live }));
      } catch { /* WebKit builds no synthetic Touch; the pointer events below carry the drag */ }
      const pointer = { touchstart: 'pointerdown', touchmove: 'pointermove', touchend: 'pointerup' }[type] ?? 'pointermove';
      el.dispatchEvent(new PointerEvent(pointer, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y - dy }));
    };
    /** @param {number} ms */
    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    fire('touchstart', 0);
    for (let i = 1; i <= 8; i++) { fire('touchmove', i * 5); await wait(16); }
    await wait(1200);
    fire('touchend', 40);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const after = await page.screenshot({ clip });
  return !before.equals(after);
}

async function cli() {
  /** @type {Map<string, string>} */
  const args = new Map();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = (argv[i] ?? '').replace(/^--/u, ''), next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i++; } else args.set(key, 'true');
  }
  const url = args.get('url') ?? 'https://staging.wildshard.io', card = args.get('card') ?? 'driftwood-isle';
  const out = resolvePath(args.get('out') ?? `tmp/${process.env.WS_LANE_NAME ?? 'journey'}/journey`);
  const browsers = (args.get('browsers') ?? 'chromium,webkit').split(','), runs = (args.get('runs') ?? 'cold,warm').split(',');
  const paths = /** @type {JourneyPath[]} */ ((args.get('paths') ?? 'select,mmo,deeplink').split(','));
  if (paths.some((p) => !['select', 'mmo', 'deeplink'].includes(p))) throw new Error('--paths takes select, mmo and deeplink');
  if (paths.includes('deeplink') && !/^[a-z0-9_-]+$/u.test(card)) throw new Error(`--card ${card}: the deep link needs a slug, not a name`);
  const throttle = Number(args.get('throttle') ?? '0');
  // SB3: --prime <dir> starts each browser from a saved profile (<dir>/<browser>), an old shell as Jake's phone holds one
  const prime = args.get('prime');
  if (/wildshard\.io/u.test(url) && !/staging/u.test(url)) throw new Error('The journey proof joins a world: staging or local only');
  const pw = await import('./browser-playwright.mjs');
  // SB3: the build staging serves, read before and after; a run whose build moved under it names none (the gate skips it)
  const served = async () => { try { return String((await (await fetch(`${url}/version.json`, { cache: 'no-store' })).json()).build); } catch { return undefined; } };
  const before = await served();
  mkdirSync(out, { recursive: true });
  let failed = false;
  /** @type {unknown[]} */
  const report = [];
  for (const name of browsers) for (const way of paths) {
    const engine = name === 'webkit' ? pw.webkit : pw.chromium;
    // one profile per browser and way: each way's cold run is a first visit, its warm run the same profile again
    const profile = join(out, `profile-${name}-${way}`);
    if (prime !== undefined) {
      if (!existsSync(join(prime, name))) throw new Error(`--prime ${prime} has no ${name} profile`);
      cpSync(join(prime, name), profile, { recursive: true });
    }
    const context = await engine.launchPersistentContext(profile, {
      ...PHONE, isMobile: name !== 'webkit', headless: true,
      ...(args.has('video') ? { recordVideo: { dir: join(out, `video-${name}`), size: PHONE.viewport } } : {}),
      ...(name === 'webkit' ? {} : { args: ['--mute-audio', '--use-mock-keychain', '--password-store=basic', '--use-angle=metal'] }),
    });
    await context.route('**/*', async (route) => { await (route.request().method() === 'GET' ? route.continue() : route.abort()); });
    // --developer: Settings ▸ Developer on, for a local build whose only cards are Developer ones (T1's ring 1, `_template`)
    if (args.has('developer')) await (await import('./debug-settings.mjs')).saveFixture(context, { scope: 'device', key: 'devMode', data: true });
    try {
      for (const run of runs) {
        const page = context.pages()[0] ?? await context.newPage();
        if (throttle > 1 && name !== 'webkit') await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
        /** @type {string[]} */
        const errors = [];
        // ZE23: a page error, a faulted system, the error card or the glitch chip each fail the run (proof-faults.mjs)
        const faults = await watchFaults(page, errors);
        await page.goto(way === 'deeplink' ? `${url}/slug/${card}` : `${url}/`, { waitUntil: 'commit' });
        let n = 0;
        const dir = join(out, `${name}-${way}-${run}`);
        mkdirSync(dir, { recursive: true });
        const samples = await tapJourney(page, { card, path: way, frames: async (row) => {
          await page.screenshot({ path: join(dir, `${String(n++).padStart(3, '0')}-${String(row.t).padStart(6, '0')}-${label(row.s)}.png`), timeout: 5000 });
        } });
        const problems = judge(samples);
        if (problems.length === 0 && !(await stickMoves(page))) problems.push({ at: samples.at(-1)?.t ?? 0, text: 'the move stick did not move the player' });
        await faults.settle();
        for (const text of errors) problems.push({ at: samples.at(-1)?.t ?? 0, text });
        /** @type {string[]} */
        const path = [];
        for (const { t, s } of samples) { const l = label(s); if (!path.at(-1)?.endsWith(`:${l}`)) path.push(`${String(t)}:${l}`); }
        const ok = problems.length === 0;
        const zones = [...new Set(samples.map((row) => row.s?.zone ?? '').filter((zone) => zone !== ''))];
        report.push({ browser: name, way, run, ok, problems, path: path.join(' '), zones, errors, samples });
        if (!ok) failed = true;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${way} ${run}: ${path.join(' ')}${zones.length > 0 ? ` (card: ${zones.join(', ')})` : ''}`);
        for (const p of problems) console.log(`  - ${String(p.at)} ms: ${p.text}`);
        await page.goto('about:blank');
      }
    } finally { await context.close(); }
  }
  const after = await served(), build = before !== undefined && before === after ? before : undefined;
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ url, card, ...(build === undefined ? {} : { build }), ...(prime === undefined ? {} : { prime }), at: new Date().toISOString(), report }, null, 1)}\n`);
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
