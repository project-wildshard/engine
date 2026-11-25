#!/usr/bin/env node
// CHUNK-PARAM-REMOVAL CP12 (meta plan, J522; Q4 answered (a)): how a tool enters a zone, the way a player does. It writes
// the Zone Select tap record into the tab (src/client/engine/boot/tapRecord.ts, the bytes the title writes) and opens a
// bare `/`; from there the page takes the player's path to the zone's grid cell, with its neighbours. No URL carries the
// zone. `alone: true` serves a one-cell world of the zone instead (CP10's catalogue, injected into `/` by route), for the
// tools that put a number on one zone (Q1 (a)).
//
//   import { enterZone } from './zone-entry.mjs';  await enterZone(page, { zone: 'pine-hollow', base });
//   node scripts/zone-entry.mjs --init <zone> [--mode enter|explore|arena]   print the init script (agent-browser, the
//                                                                              WebKit inspector): run it on the origin, then open /
import { pathToFileURL } from 'node:url';
import { tapRecord, tapSessionDocument } from '../src/client/engine/boot/tapRecord.ts';

/** The game's save prefix (src/client/game/identity.ts `savePrefix`, epoch 2; zone-entry.test.mjs keeps them equal). */
export const SAVE_PREFIX = 'wildshard.save.v2@2.';
const ZONE = /^[a-z0-9_-]+$/u;
const MODES = new Set(['enter', 'explore', 'arena']);

/** @param {string} zone @param {string} mode */
function checked(zone, mode) {
  if (!ZONE.test(zone)) throw new Error(`zone-entry: "${zone}" is not a zone slug`);
  if (!MODES.has(mode)) throw new Error(`zone-entry: mode "${mode}" is not enter, explore or arena`);
}

/** The tap's session document for `zone`, as the title would leave it, given the tab's current one (`held`).
 *  @param {{ zone: string; mode?: string; name?: string; at?: number; held?: string | null }} tap */
export function tapDocument({ zone, mode = 'enter', name, at = Date.now(), held = null }) {
  checked(zone, mode);
  return tapSessionDocument(held, tapRecord({ slug: zone, mode: /** @type {'enter'} */ (mode), ...(name === undefined ? {} : { name }) }, at));
}

/** A script that writes the tap into this origin's tab when run on any page of it (the tap's time is the run's).
 *  @param {string} zone @param {string} [mode] @param {string} [prefix] */
export function initScript(zone, mode = 'enter', prefix = SAVE_PREFIX) {
  checked(zone, mode);
  const key = JSON.stringify(`${prefix}session`);
  return `(() => { const key = ${key}; const held = sessionStorage.getItem(key);
  let doc = { keys: {} }; try { const parsed = JSON.parse(held ?? 'null'); if (parsed && typeof parsed.keys === 'object' && parsed.keys) doc = { ...parsed, keys: { ...parsed.keys } }; } catch {}
  doc.keys.titleArrival = { v: 1, data: JSON.stringify({ slug: ${JSON.stringify(zone)}, mode: ${JSON.stringify(mode)}, at: Date.now() }) };
  sessionStorage.setItem(key, JSON.stringify(doc)); })();`;
}

/** The build's catalogue with only `zone`'s cell and placement: a one-cell world (CP10).
 *  @param {{ placements?: { slug: string }[]; grid?: { cells?: { slug: string }[] } }} catalogue @param {string} zone */
export function oneCellCatalogue(catalogue, zone) {
  const bare = (/** @type {string} */ slug) => slug.replace(/^_/u, '');
  const cells = (catalogue.grid?.cells ?? []).filter(cell => bare(cell.slug) === zone);
  if (cells.length !== 1) throw new Error(`zone-entry: the build's catalogue has ${String(cells.length)} cells for ${zone}, not one`);
  return { ...catalogue, placements: (catalogue.placements ?? []).filter(row => bare(row.slug) === zone), grid: { ...catalogue.grid, cells } };
}

const INLINE = /<script type="application\/json" id="ws-catalogue">([^<]*)<\/script>/u;
/** `/`'s HTML with its inline catalogue cut to `zone`'s one cell. @param {string} html @param {string} zone */
export function oneCellPage(html, zone) {
  const found = INLINE.exec(html);
  if (found?.[1] === undefined) throw new Error('zone-entry: this build inlines no ws-catalogue, so it has no world to cut to one cell');
  const text = JSON.stringify(oneCellCatalogue(JSON.parse(found[1]), zone)).replaceAll('<', String.raw`<`);
  return html.replace(INLINE, () => `<script type="application/json" id="ws-catalogue">${text}</script>`);
}

/** Enter `zone` like a player: the tap in the tab, then `/`. `base` is the build's origin (default: the page's own).
 *  @param {import('playwright').Page} page
 *  @param {{ zone: string; base?: string; mode?: 'enter' | 'explore' | 'arena'; name?: string; alone?: boolean; prefix?: string;
 *    waitUntil?: 'load' | 'domcontentloaded' | 'commit' }} options */
export async function enterZone(page, { zone, base, mode = 'enter', name, alone = false, prefix = SAVE_PREFIX, waitUntil = 'load' }) {
  checked(zone, mode);
  const origin = new URL(base ?? page.url()).origin;
  if (origin === 'null') throw new Error('zone-entry: give a base URL, the page is on no origin yet');
  const home = `${origin}/`;
  // The tab's storage belongs to the origin: stand on it (a small static file, never a page that boots) to write the tap.
  if (new URL(page.url() === 'about:blank' ? 'about:blank' : page.url()).origin !== origin) await page.goto(`${origin}/version.json`, { waitUntil: 'commit' });
  await page.evaluate(({ key, raw }) => { sessionStorage.setItem(key, raw); },
    { key: `${prefix}session`, raw: tapDocument({ zone, mode, ...(name === undefined ? {} : { name }), held: await page.evaluate(k => sessionStorage.getItem(k), `${prefix}session`) }) });
  if (alone) {
    await page.route(home, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: oneCellPage(await response.text(), zone) });
    });
  }
  await page.goto(home, { waitUntil });
  if (alone) await page.unroute(home);
  return page;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), at = args.indexOf('--init'), modeAt = args.indexOf('--mode');
  const zone = at === -1 ? undefined : args[at + 1];
  if (zone === undefined) { console.error('usage: node scripts/zone-entry.mjs --init <zone> [--mode enter|explore|arena]'); process.exit(2); }
  console.log(initScript(zone, modeAt === -1 ? 'enter' : args[modeAt + 1]));
}
