#!/usr/bin/env node
// STANDALONE-SHARDFILES SF14 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md, J525): the ship proof.
// A deployed zone-free page (staging by default) enters every zone its zone table names from the cook, on a headless desktop
// and a 402x874 phone, sound off. A run fails when a tier misses gameplay or when the page's own origin answers any zone art: a
// zone's bytes come only from its cook (`zone-table.json`'s origin, `cooked.wildshard.io` by default). zone-cook-entry.mjs is the
// local half of the same proof (SF5 to SF9); this one runs against the live page once the re-packed zones pin.
//
//   node src/scripts/ship-zone-entry.mjs [--base https://staging.wildshard.io] [--zones slug,slug] [--tiers desktop,phone]
//     [--out tmp/ship-zone-entry] [--timeout ms] [--settle ms] [--alone]
// The proof is `<out>/ship.json`: per zone and tier, the gameplay time, the reads by origin, `zoneFromCook` (the zone's reads the
// cook answered), `zoneFromPage` (page-origin zone art) and the missing reads. Exit 1 when any zone and tier misses gameplay,
// reads nothing of its zone from the cook, or reads zone art from the page.
// Automation on staging and production carries the agent marker: the marked Playwright (browser-playwright.mjs) and the
// `?agent=` carrier on the entry URL.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {isArt, readList} from './public-verdicts.mjs';

const COOKED = 'https://cooked.wildshard.io/';
const FINGERPRINT = /-[0-9a-f]{16}(\.[a-z0-9]+)$/u;
const ENGINE_LIST = 'src/scripts/public-engine.json';
/** What the build writes under public/ itself: physics, Basis and the spawn packs (SF12's runtime). @param {string} file */
const isRuntime = file => /^(?:assets\/(?:physics|spawn|packs)\/|basis\/)/u.test(file);

/** The zones and cook origin a page's zone table names (the shape `src/shared/game/grid/zoneTable.ts` reads).
 * @param {unknown} input @returns {{origin: string, zones: string[]}} */
export function tableZones(input) {
  const table = /** @type {{version?: unknown, origin?: unknown, zones?: unknown}} */ (input ?? {});
  if (table.version !== 1 || !Array.isArray(table.zones) || table.zones.length === 0) throw new Error('Not a zone table: the page is not zone-free yet');
  const zones = table.zones.map(row => {
    const slug = /** @type {{slug?: unknown}} */ (row).slug;
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/u.test(slug)) throw new Error('A zone table row has no slug');
    return slug;
  });
  return {origin: typeof table.origin === 'string' ? table.origin : COOKED, zones};
}

/** Zone art the page origin answered: an art path (`/assets/` or `/programs/`, the build's fingerprint dropped) that names a
 *  zone, sits under `/shardfiles/`, or is neither on SF1's engine list nor the build's runtime. The title's art is the page's own.
 * @param {string} path a URL path on the page origin @param {{engine: ReadonlySet<string>, zones: readonly string[]}} known
 * @returns {boolean} */
export function zoneArtFromPage(path, {engine, zones}) {
  if (path.startsWith('/shardfiles/')) return true;
  const file = path.replace(FINGERPRINT, '$1').slice(1);
  if (!isArt(file) || file.startsWith('assets/title/')) return false;
  return zones.some(slug => file.includes(slug)) || (!engine.has(file) && !isRuntime(file));
}

/** One tier's reads, split by origin. `zoneFromCook` counts the cook's answered reads under the entered zone's own prefix
 *  (`shards/<slug>/`), so a page that entered without reading its zone from the cook can't pass (codex-cookkeys' review).
 *  @param {{url: string, status: number}[]} reads @param {{page: string, cook: string, zone: string,
 *  engine: ReadonlySet<string>, zones: readonly string[]}} where */
export function tierReads(reads, {page, cook, zone, engine, zones}) {
  const pageOrigin = new URL(page).origin, cookOrigin = new URL(cook).origin;
  const onPage = reads.filter(row => new URL(row.url).origin === pageOrigin);
  const zoneFromPage = onPage.filter(row => row.status >= 200 && row.status < 400 && zoneArtFromPage(new URL(row.url).pathname, {engine, zones}))
    .map(row => new URL(row.url).pathname);
  const fromCook = reads.filter(row => new URL(row.url).origin === cookOrigin);
  const zoneFromCook = fromCook.filter(row => row.status >= 200 && row.status < 300 && new URL(row.url).pathname.includes(`/shards/${zone}/`)).length;
  return {requests: reads.length, fromCook: fromCook.length, zoneFromCook, fromPage: onPage.length,
    zoneFromPage: [...new Set(zoneFromPage)].sort(), missing: [...new Set(reads.filter(row => row.status === 404 || row.status === -1).map(row => row.url))].sort()};
}

/** Why a tier fails, or undefined when it passes: gameplay reached, at least one of its zone's reads answered by the cook, and
 *  no zone art from the page. @param {{gameplayMs: number|null, zoneFromCook: number, zoneFromPage: readonly string[]}} verdict */
export function tierFailure({gameplayMs, zoneFromCook, zoneFromPage}) {
  if (gameplayMs === null) return 'no gameplay';
  if (zoneFromCook === 0) return 'no read of the zone from the cook';
  if (zoneFromPage.length > 0) return `zone art from the page (${zoneFromPage.slice(0, 3).join(', ')})`;
  return undefined;
}

async function main() {
  const {values: o} = parseArgs({options: {base: {type: 'string', default: 'https://staging.wildshard.io'}, zones: {type: 'string'},
    tiers: {type: 'string', default: 'desktop,phone'}, out: {type: 'string', default: 'tmp/ship-zone-entry'}, timeout: {type: 'string', default: '120000'},
    settle: {type: 'string', default: '3000'}, alone: {type: 'boolean', default: false}}});
  const base = new URL(o.base).origin, out = resolve(o.out);
  mkdirSync(out, {recursive: true});
  const {agentHeaders, agentUrl} = await import('./agent-marker.mjs');
  const response = await fetch(`${base}/zone-table.json`, {headers: agentHeaders()});
  if (!response.ok) throw new Error(`${base}/zone-table.json: HTTP ${response.status}; the page is not zone-free yet`);
  const table = tableZones(await response.json());
  const zones = o.zones === undefined ? table.zones : o.zones.split(',');
  const missingZones = zones.filter(slug => !table.zones.includes(slug));
  if (missingZones.length > 0) throw new Error(`The page's zone table has no ${missingZones.join(', ')}`);
  const engine = readList(resolve(ENGINE_LIST));
  const {chromium} = await import('./browser-playwright.mjs');
  const {KEYCHAIN_ARGS} = await import('./.kit/chromium-keychain.mjs');
  const {enterZone} = await import('./zone-entry.mjs');
  const {bootObservation} = await import('./parity/boot-smoke.mjs');
  const {NAME_ASKED, saveFixture} = await import('./debug-settings.mjs');
  // The agent marker's query carrier rides the entry URL's flags.
  const marked = new URL(agentUrl(`${base}/`)).searchParams.toString();
  const flags = ['mute=1', 'nolock=1', 'skipintro=1', 'sw=0', marked].filter(Boolean).join('&');
  const shapes = {desktop: {viewport: {width: 1280, height: 800}, deviceScaleFactor: 1},
    phone: {viewport: {width: 402, height: 874}, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}};
  const gpu = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  // Headless and muted (Jake, 2026-11-24), with no keychain dialog.
  const browser = await chromium.launch({headless: true, args: ['--mute-audio', '--no-first-run', '--disable-extensions', ...gpu, ...KEYCHAIN_ARGS]});
  /** @type {Record<string, Record<string, unknown>>} */
  const results = {};
  let failed = false;
  try {
    for (const slug of zones) {
      results[slug] = {};
      for (const tier of o.tiers.split(',')) {
        const shape = shapes[/** @type {'desktop'|'phone'} */ (tier)];
        if (shape === undefined) throw new Error(`Unknown tier ${tier}`);
        const context = await browser.newContext({...shape, serviceWorkers: 'block'}), page = await context.newPage();
        await saveFixture(context, NAME_ASKED);
        /** @type {{url: string, status: number}[]} */ const reads = [];
        /** @type {string[]} */ const errors = [];
        context.on('requestfinished', request => { void request.response().then(answer => { reads.push({url: request.url(), status: answer?.status() ?? 0}); }); });
        context.on('requestfailed', request => { reads.push({url: request.url(), status: -1}); });
        page.on('pageerror', error => { errors.push(String(error.message).slice(0, 300)); });
        const started = Date.now();
        let gameplayMs = null;
        try {
          await enterZone(page, {zone: slug, base, flags, alone: o.alone, waitUntil: 'commit', timeout: Number(o.timeout)});
          for (const deadline = Date.now() + Number(o.timeout); ;) {
            const seen = await page.evaluate(bootObservation).catch(() => null);
            if (seen !== null && seen.fatal.length > 0) throw new Error(`fatal: ${seen.fatal.join(' | ').slice(0, 300)}`);
            if (seen?.ready === true) break;
            if (seen?.revealing === true) await page.locator('.ws-grid-reveal').dispatchEvent('pointerdown').catch(() => undefined);
            if (Date.now() > deadline) throw new Error(`no gameplay in ${o.timeout} ms (app ${seen?.appState ?? 'unavailable'})`);
            await page.waitForTimeout(500);
          }
          gameplayMs = Date.now() - started;
          await page.waitForTimeout(Number(o.settle));
        } catch (error) { errors.push(String(error instanceof Error ? error.message : error).split('\n')[0] ?? ''); }
        await page.screenshot({path: join(out, `${slug}-${tier}.jpg`), type: 'jpeg', quality: 80}).catch(() => undefined);
        await context.close();
        const verdict = {gameplayMs, ...tierReads(reads, {page: base, cook: table.origin, zone: slug, engine, zones: table.zones}), errors};
        results[slug][tier] = verdict;
        const why = tierFailure(verdict);
        if (why !== undefined) failed = true;
        console.log(`${slug} ${tier}: ${why === undefined ? 'pass' : `FAIL: ${why}`}; gameplay ${gameplayMs === null ? 'MISSED' : `${gameplayMs} ms`}, ${verdict.requests} reads (${verdict.fromCook} cook, ${verdict.zoneFromCook} of the zone; ${verdict.fromPage} page), zone art from the page ${verdict.zoneFromPage.length}, missing ${verdict.missing.length}`);
      }
    }
  } finally { await browser.close(); }
  writeFileSync(join(out, 'ship.json'), JSON.stringify({base, cook: table.origin, zones, at: new Date().toISOString(), results}, null, 1));
  if (failed) process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
