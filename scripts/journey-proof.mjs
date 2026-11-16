#!/usr/bin/env node
// BUGBASH-LOOP (meta STAGING-BUGBASH, J385/J386): the player's own way into a world, tapped on a phone, judged frame by frame.
// The only screens allowed are the main menu, Shard Select, the world's full-screen loading card and play. A bounce back to a
// menu, the bare launch shell on a world page, the HUD over a menu, a loading card shrunk to a bar or a blank wait fails.
//
//   node scripts/journey-proof.mjs --url https://staging.wildshard.io --card driftwood-isle [--browsers chromium,webkit]
//        [--runs cold,warm] [--throttle 4] [--out tmp/<lane>/journey] [--video]
//
// The T1 spec (src/e2e/t1/journey.spec.ts) drives the same `tapJourney` against the local build; this CLI is the release
// staging gate (J386), run before any prod promote. It only reads: every request but a GET is aborted.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

/** @typedef {import('playwright').Page} Page */
/** @typedef {{ doc: number, path: string, shell: boolean, title: boolean, select: boolean, loading: boolean, bar: boolean, hud: boolean, modal: boolean, reveal?: boolean }} Screen */
/** @typedef {{ t: number, s: Screen | null }} Sample */
/** @typedef {{ at: number, text: string }} Problem */

/** iPhone 17 Pro portrait, as Jake holds it. */
export const PHONE = Object.freeze({
  viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
});

/** Runs in the page: what the player sees right now. Plain DOM reads only, so it works on any build (no harness probe).
 * @returns {Screen} */
export function screenNow() {
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
    doc: Math.round(performance.timeOrigin), path: location.pathname + location.search,
    shell: shown('[data-title-shell]'), title: shown('.ws-main:not(.hide)'), select: shown('.ws-menu:not(.hide)'),
    loading: load !== undefined && loadHeight >= innerHeight * 0.8, bar: load !== undefined && loadHeight < innerHeight * 0.8,
    hud: shown('.ws-touch') || shown('.ws-minimap'), modal: shown('#wsdrop, .ws-err, .ws-fail'),
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
  /** @param {number} at @param {string} text */
  const say = (at, text) => { if (!problems.some((p) => p.text === text)) problems.push({ at, text }); };
  for (const { t, s } of samples) {
    const what = label(s), later = s !== null && s.doc !== tapDoc;
    if (s !== null && s.hud && (s.title || s.select || s.shell)) say(t, 'the in-game HUD is drawn over a menu');
    if (what === 'shell') say(t, 'the bare launch shell (lone SHARD SELECT, LOADING) shows on the world page');
    if (what === 'title') say(t, 'the main menu came back after Enter World');
    if (what === 'select' && later) say(t, 'Shard Select came back after Enter World');
    if (what === 'bar') say(t, 'the loading card is shrunk to a bar');
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

/** Tap from the title to Shard Select, pick `card` by slug or name, tap Enter World, and sample until play holds for 2 s.
 * @param {Page} page @param {{ card: string, budgetMs?: number, sampleMs?: number, frames?: (row: Sample) => Promise<void> }} options
 * @returns {Promise<Sample[]>} */
export async function tapJourney(page, { card, budgetMs = 90_000, sampleMs = 120, frames }) {
  const selectCard = page.locator('.ws-main-select');
  await selectCard.waitFor({ state: 'visible', timeout: 60_000 });
  // A drop note from the page before (a crash, an unmarked leave) is the title's own modal: dismiss it before every tap.
  const clear = async () => {
    await page.waitForTimeout(300);
    const dismiss = page.locator('#wsdrop .dismiss');
    if (await dismiss.isVisible()) await dismiss.tap();
  };
  await clear();
  await selectCard.tap();
  await page.locator('#ws-name-box, .ws-title-stack[data-screen="select"]').first().waitFor({ timeout: 15_000 });
  const skip = page.locator('#ws-name-box [data-name=skip]');
  if (await skip.isVisible()) await skip.tap();
  await clear();
  await page.locator('.ws-title-stack[data-screen="select"]').waitFor({ timeout: 15_000 });
  /** @type {unknown} */
  const rows = JSON.parse((await page.locator('#ws-title-rows').textContent()) ?? '[]');
  const row = Array.isArray(rows) ? rows.find((r) => typeof r === 'object' && r !== null && (r.slug === card || r.name === card)) : undefined;
  if (row === undefined) throw new Error(`No title row ${card}`);
  const names = await page.locator('.ws-menu-card b').allTextContents();
  const index = names.findIndex((n) => n.toLowerCase() === String(row.name).toLowerCase());
  if (index === -1) throw new Error(`No Shard Select card for ${String(row.name)}`);
  await clear();
  await page.locator(`.ws-menu-dots i[data-i="${String(index)}"]`).tap();
  await page.locator(`.ws-menu-card.selected[data-i="${String(index)}"]`).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);
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
  await clear();
  await sample();
  await page.locator('.ws-menu-play').tap();
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
  const throttle = Number(args.get('throttle') ?? '0');
  if (/wildshard\.io/u.test(url) && !/staging/u.test(url)) throw new Error('The journey proof joins a world: staging or local only');
  const pw = await import('playwright');
  mkdirSync(out, { recursive: true });
  let failed = false;
  /** @type {unknown[]} */
  const report = [];
  for (const name of browsers) {
    const engine = name === 'webkit' ? pw.webkit : pw.chromium;
    const context = await engine.launchPersistentContext(join(out, `profile-${name}`), {
      ...PHONE, isMobile: name !== 'webkit', headless: true,
      ...(args.has('video') ? { recordVideo: { dir: join(out, `video-${name}`), size: PHONE.viewport } } : {}),
      ...(name === 'webkit' ? {} : { args: ['--mute-audio', '--use-mock-keychain', '--password-store=basic', '--use-angle=metal'] }),
    });
    await context.route('**/*', async (route) => { await (route.request().method() === 'GET' ? route.continue() : route.abort()); });
    try {
      for (const run of runs) {
        const page = context.pages()[0] ?? await context.newPage();
        if (throttle > 1 && name !== 'webkit') await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
        /** @type {string[]} */
        const errors = [];
        page.on('pageerror', (e) => { errors.push(e.message); });
        await page.goto(`${url}/`, { waitUntil: 'commit' });
        let n = 0;
        const dir = join(out, `${name}-${run}`);
        mkdirSync(dir, { recursive: true });
        const samples = await tapJourney(page, { card, frames: async (row) => {
          await page.screenshot({ path: join(dir, `${String(n++).padStart(3, '0')}-${String(row.t).padStart(6, '0')}-${label(row.s)}.png`), timeout: 5000 });
        } });
        const problems = judge(samples);
        if (problems.length === 0 && !(await stickMoves(page))) problems.push({ at: samples.at(-1)?.t ?? 0, text: 'the move stick did not move the player' });
        /** @type {string[]} */
        const path = [];
        for (const { t, s } of samples) { const l = label(s); if (!path.at(-1)?.endsWith(`:${l}`)) path.push(`${String(t)}:${l}`); }
        const ok = problems.length === 0;
        report.push({ browser: name, run, ok, problems, path: path.join(' '), errors });
        if (!ok) failed = true;
        console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${run}: ${path.join(' ')}`);
        for (const p of problems) console.log(`  - ${String(p.at)} ms: ${p.text}`);
        await page.goto('about:blank');
      }
    } finally { await context.close(); }
  }
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ url, card, at: new Date().toISOString(), report }, null, 1)}\n`);
  process.exitCode = failed ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
