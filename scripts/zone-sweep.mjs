#!/usr/bin/env node
// Meta QA-FEEDBACK-2026-11-17 row 21 (Jake, ~14:35 Cancún: "i have no confidence that each one of the zones in zone select will
// open"): open every card Zone select shows, one at a time, each in a fresh phone context, and judge each entry. The release
// gate's journeys (verify-staging.sh, SB3) read Driftwood and Pine only; this reads the list the page itself shows: the build's
// `#ws-title-rows` plus whatever the channel's placement file and the API's catalogue add at runtime (SA33, SA46).
//
//   node scripts/zone-sweep.mjs --url https://staging.wildshard.io [--browser chromium|webkit] [--out <dir>] [--only a,b] [--budget 60000]
//   node scripts/zone-sweep.mjs --url https://play.wildshard.io --block-ws   (production: loads only, the world's socket is refused)
//   --chunk  open each zone by its cold link, `/?chunk=<slug>&skipintro=1` (a PLAY or shared link, a reload in the zone), not by its
//            card: a tap enters the in-page grid and never runs a cold boot's merge, so ONE-FORMAT OF8 (an upload refused on a cold
//            boot) passed a card sweep (OF8b). --only slugs with no card are listed in results.json `missing` (SA48), not swept.
//
// A zone passes when the player is in the world (journey-proof's `play` label: the HUD drawn) within the budget, with no error
// card, glitch chip, faulted system or uncaught page error (proof-faults.mjs). Only GETs leave the page. Output:
// <out>/results.json (`build`, `browser`, `cards[]`, `results[]`) and one screenshot per zone; exit 1 when any zone fails.
// page-release.mjs reads results.json (flow.mjs `zoneSweepRows`) and production go-live refuses a failed or missing sweep.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PHONE, judge, label, tapJourney } from './journey-proof.mjs';
import { watchFaults } from './proof-faults.mjs';
import { smokeProbes } from './staging-smoke/scenarios.mjs';

/** @typedef {{ i: number, name: string, sub: string, enters: boolean, thumb: string }} SweepCard */
/** @typedef {{ slug: string, name: string, pass: boolean, enterMs: number | null, errors: readonly string[], modal: boolean, thrown: string,
 *   zones: readonly string[], problems: readonly string[], path: string, bad: readonly string[], failed: readonly string[], console: readonly string[], shot: string }} SweepResult */

/** The pass rule: in the world within the budget, in the zone the card names, no error card or fault, nothing thrown by the driver.
 * @param {{ enterMs: number | null, errors: readonly string[], modal: boolean, thrown: string, name?: string, zones?: readonly string[] }} row @param {number} budgetMs @returns {boolean} */
export function zoneVerdict(row, budgetMs) {
  return row.thrown === '' && row.enterMs !== null && row.enterMs <= budgetMs && row.errors.length === 0 && !row.modal && wrongZone(row) === undefined;
}

/** The zone the loading card named when it is not the card tapped (Sky Reach's card loading Signal Dunes), else undefined.
 * @param {{ name?: string, zones?: readonly string[] }} row @returns {string | undefined} */
export function wrongZone(row) {
  const want = (row.name ?? '').trim().toLowerCase();
  return want === '' ? undefined : (row.zones ?? []).find((zone) => zone.trim() !== '' && zone.trim().toLowerCase() !== want);
}

/** The cold link a PLAY or shared link opens; `skipintro` passes the title an online build shows a bare link (QA row 16).
 * @param {string} url @param {string} slug @returns {string} */
export function chunkLink(url, slug) {
  return `${url.replace(/\/+$/u, '')}/?chunk=${encodeURIComponent(slug)}&skipintro=1`;
}

/** The cards to open (all, or those `--only` names by slug) and the `--only` slugs that have no card.
 * @param {readonly { name: string }[]} cards @param {Record<string, string>} slugs @param {readonly string[] | undefined} only
 * @returns {{ targets: { slug: string, name: string }[], missing: string[] }} */
export function sweepTargets(cards, slugs, only) {
  const all = cards.map((card) => ({ slug: slugs[card.name] ?? card.name, name: card.name }));
  if (only === undefined) return { targets: all, missing: [] };
  return { targets: all.filter((t) => only.includes(t.slug)), missing: only.filter((slug) => !all.some((t) => t.slug === slug)) };
}

/** Runs in the page with Zone select open: the cards as the player sees them. @returns {SweepCard[]} */
export function cardsNow() {
  return [...document.querySelectorAll('.ws-menu-card')].map((el) => {
    const b = /** @type {HTMLElement} */ (el);
    return { i: Number(b.dataset.i), name: b.querySelector('b')?.textContent ?? '', sub: b.querySelector('small')?.textContent ?? '',
      enters: b.dataset.enters === '1', thumb: b.querySelector('.ws-menu-card-img') instanceof HTMLElement ? /** @type {HTMLElement} */ (b.querySelector('.ws-menu-card-img')).style.backgroundImage : '' };
  });
}

/** Runs in the page: each installed title row's slug by name (the cards carry names). @returns {Record<string, string>} */
export function slugsByName() {
  const rows = /** @type {readonly { slug: string, name: string }[] | undefined} */ (Reflect.get(globalThis, Symbol.for('game.titleManifests')));
  return Object.fromEntries((rows ?? []).map((row) => [row.name, row.slug]));
}

/** @param {import('playwright').Page} page @param {{ bad: string[], failed: string[], console: string[] }} net */
function watchNet(page, net) {
  page.on('requestfailed', (r) => { const why = r.failure()?.errorText ?? ''; if (r.method() === 'GET' && !/ERR_ABORTED/u.test(why)) net.failed.push(`${why} ${r.url().slice(0, 200)}`); });
  page.on('response', (r) => { if (r.status() >= 400) net.bad.push(`${String(r.status())} ${r.url().slice(0, 200)}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED/u.test(m.text())) net.console.push(m.text().slice(0, 300)); });
}

/** @param {import('playwright').Page} page */
async function openSelect(page) {
  await page.locator('.ws-main-select').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(300);
  const dismiss = page.locator('#wsdrop .dismiss');
  if (await dismiss.isVisible()) await dismiss.tap();
  await page.locator('.ws-main-select').tap();
  await page.locator('#ws-name-box, .ws-title-stack[data-screen="select"]').first().waitFor({ timeout: 15_000 });
  const skip = page.locator('#ws-name-box [data-name=skip]');
  if (await skip.isVisible()) await skip.tap();
  await page.locator('.ws-title-stack[data-screen="select"]').waitFor({ timeout: 15_000 });
}

async function cli() {
  /** @type {Map<string, string>} */
  const args = new Map();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = (argv[i] ?? '').replace(/^--/u, ''), next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { args.set(key, next); i++; } else args.set(key, 'true');
  }
  const url = args.get('url') ?? 'https://staging.wildshard.io', browserName = args.get('browser') ?? 'chromium';
  const out = resolve(args.get('out') ?? `tmp/${process.env.WS_LANE_NAME ?? 'zone-sweep'}/zone-sweep`);
  const budgetMs = Number(args.get('budget') ?? '60000'), blockWs = args.has('block-ws'), only = args.get('only')?.split(','), cold = args.has('chunk');
  if (browserName !== 'chromium' && browserName !== 'webkit') throw new Error('--browser takes chromium or webkit');
  if (/wildshard\.io/u.test(url) && !/staging/u.test(url) && !blockWs) throw new Error('Production: pass --block-ws, loads only (lane rules: never join a world there)');
  mkdirSync(out, { recursive: true });
  const served = async () => { try { return String((await (await fetch(`${url}/version.json`, { cache: 'no-store' })).json()).build); } catch { return undefined; } };
  const before = await served();
  const pw = await import('./browser-playwright.mjs');
  const engine = browserName === 'webkit' ? pw.webkit : pw.chromium;
  const browser = await engine.launch({ headless: true, ...(browserName === 'webkit' ? {} : { args: ['--mute-audio', '--use-mock-keychain', '--password-store=basic', '--use-angle=metal'] }) });
  const fresh = async () => {
    const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 1, isMobile: browserName !== 'webkit' });
    await context.route('**/*', async (route) => { await (route.request().method() === 'GET' ? route.continue() : route.abort()); });
    if (blockWs) await context.routeWebSocket(/.*/u, (ws) => { void ws.close({ code: 4000, reason: 'zone-sweep: loads only' }); });
    await context.addInitScript(smokeProbes); // rAF capped at 60 fps: the GPU is Jake's
    // SB42: the lane's door pass, so a sweep's joins never spend the address Jake's phone shares
    const pass = (await import('./door-pass.mjs')).doorPassInit(process.env.WS_LANE_NAME ?? 'zone-sweep'); if (pass !== null) await context.addInitScript(pass);
    return context;
  };
  /** @type {SweepResult[]} */
  const results = [];
  /** @type {SweepCard[]} */
  let cards = [];
  /** @type {Record<string, string>} */
  let slugs = {};
  /** @type {string[]} */
  let missing = [];
  try {
    const listing = await fresh();
    const page = await listing.newPage();
    await page.goto(`${url}/`, { waitUntil: 'commit' });
    await openSelect(page);
    // an upload's card joins once the placement file and its catalogue entry answer (3 s deadline): wait as a player would
    await page.waitForTimeout(10_000);
    cards = await page.evaluate(cardsNow);
    slugs = await page.evaluate(slugsByName);
    await listing.close();
    console.log(`cards: ${cards.map((c) => c.name).join(', ')}`);
    const picked = sweepTargets(cards, slugs, only);
    missing = picked.missing;
    for (const slug of missing) console.log(`NO CARD ${slug}: Zone select shows no card for it`);
    for (const { slug, name } of picked.targets) {
      const card = { name };
      const context = await fresh(), zone = await context.newPage();
      /** @type {string[]} */
      const errors = [];
      const faults = await watchFaults(zone, errors);
      const net = { bad: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]), console: /** @type {string[]} */ ([]) };
      watchNet(zone, net);
      /** @type {import('./journey-proof.d.mts').Sample[]} */
      let samples = [];
      let thrown = '', lead = 0;
      try {
        const opened = Date.now();
        await zone.goto(cold ? chunkLink(url, slug) : `${url}/`, { waitUntil: 'commit' });
        // a cold link boots straight into its world (or shows the zone's ENTER ZONE): time it from the load, not a tap
        lead = Date.now() - opened;
        samples = await tapJourney(zone, cold ? { card: card.name, path: 'deeplink', budgetMs } : { card: card.name, budgetMs });
      } catch (error) { thrown = (error instanceof Error ? error.message : String(error)).slice(0, 300); }
      await faults.settle();
      const shot = join(out, `${slug}.jpg`);
      await zone.screenshot({ path: shot, type: 'jpeg', quality: 60, timeout: 10_000 }).catch(() => undefined);
      await context.close();
      const tap = cold ? -lead : samples[0]?.t ?? 0, played = samples.find((row) => label(row.s) === 'play');
      /** @type {string[]} */
      const path = [];
      for (const { t, s } of samples) { const l = label(s); if (!path.at(-1)?.endsWith(`:${l}`)) path.push(`${String(t - tap)}:${l}`); }
      // the zones the loading card named (journey-proof's `zone`): a card that loads another zone fails
      const zones = [...new Set(samples.map((r) => r.s?.zone ?? '').filter((z) => z !== ''))];
      const row = { enterMs: played === undefined ? null : played.t - tap, errors, modal: samples.some((s) => s.s?.modal === true), thrown, name: card.name, zones };
      const result = { slug, name: card.name, pass: zoneVerdict(row, budgetMs), ...row,
        problems: samples.length === 0 ? [] : judge(samples, { budgetMs }).map((p) => `${String(p.at - tap)} ms: ${p.text}`), path: path.join(' '), ...net, shot };
      results.push(result);
      const wrong = wrongZone(row);
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${slug}: ${result.enterMs === null ? 'never in the world' : `in the world in ${String(result.enterMs)} ms`}${wrong === undefined ? '' : `, but the loading card named ${wrong}`}${thrown === '' ? '' : `, ${thrown}`}`);
      for (const line of [...errors, ...net.bad.map((b) => `HTTP ${b}`)]) console.log(`  - ${line}`);
    }
  } finally { await browser.close(); }
  const after = await served(), build = before !== undefined && before === after ? before : undefined;
  writeFileSync(join(out, 'results.json'), `${JSON.stringify({ url, ...(build === undefined ? {} : { build }), browser: browserName, blockWs, entry: cold ? 'chunk' : 'card', missing, at: new Date().toISOString(), cards, results }, null, 1)}\n`);
  const passed = results.filter((r) => r.pass).length;
  console.log(`${passed === results.length && results.length > 0 ? 'PASS' : 'FAIL'} zone sweep ${browserName}${cold ? ' (?chunk= cold links)' : ''}: ${String(passed)} of ${String(results.length)} zones open${build === undefined ? ' (the build moved during the run)' : ''}`);
  process.exitCode = passed === results.length && results.length > 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) await cli();
