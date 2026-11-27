#!/usr/bin/env node
// MAP-NEXT MN4 (meta docs/plans/MULTI-REPO-SAGA/MMO-SAGA/MAP-NEXT-PLAN.md; J450, Jake 2026-11-19: "The map and the minimap should
// never be broken ... done at cook time"): every head a staging or production page can read through the cook has its map.
//   node src/scripts/cooked-map-audit.mjs [--channel production|staging]... [--json]
// For each channel it reads the page's build (`<origin>/version.json`), the signed placement file's cells (`<channel>-
// placements.json`, read, not verified: this is a report) and the API catalogue's live, preview and staging heads, then each head's
// cook index for that build (`index/<build>/<hash>.json`, as `placedContent.ts` reads it). A head is missing its map when:
//   no-map    its index lacks either `cooked-map-v1` key (the page draws its olive plot);
//   map-404   its index lists both keys but the store does not serve one;
//   no-index  a placed cell's head has no index for the page's build (the page leaves the zone out, map and all).
// A catalogue head that no placed cell names and that has no index for this build is listed as `uncooked`, not missing: no page of
// that build reads it. Exit 1 when any head is missing its map (MN6's scheduled audit goes red on it, naming the slug).
import { agentFetch } from './agent-requests.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

/** @typedef {'production' | 'staging'} Channel */
/** @typedef {'ok' | 'no-map' | 'map-404' | 'no-index' | 'uncooked'} HeadState */
/** @typedef {{channel: Channel, build: string, slug: string, hash: string, from: string[], state: HeadState, detail?: string}} HeadRow */

export const ORIGINS = Object.freeze({ production: 'https://play.wildshard.io', staging: 'https://staging.wildshard.io' });
export const PACKS = 'https://packs.wildshard.io/', API = 'https://api.wildshard.io';
const RELEASES = 'https://releases.wildshard.io/';
/** The states that make the audit red. */
export const MISSING = Object.freeze(['no-map', 'map-404', 'no-index']);
const HEX = /^[a-f0-9]{64}$/u;
const fileName = (/** @type {string} */ key) => key.slice(key.lastIndexOf('/') + 1);
/** The cook's map paths, as `src/shared/game/shardfile/cookedMapPath.ts` names them (version 1). */
export const mapKeys = (/** @type {string} */ loose, /** @type {string} */ slug) =>
  ['', '-cell'].map(size => `${loose}shardfiles/${slug.replace(/^_/u, '')}/cooked-map-v1${size}.png`);

/**
 * @param {{fetch?: typeof fetch, channels?: readonly Channel[], origins?: Readonly<Record<Channel, string>>, packs?: string, releases?: string, api?: string, now?: () => number}} [ports]
 * @returns {Promise<HeadRow[]>}
 */
export async function auditCookedMaps(ports = {}) {
  const read = ports.fetch ?? agentFetch, origins = ports.origins ?? ORIGINS, packs = ports.packs ?? PACKS, releases = ports.releases ?? RELEASES, api = ports.api ?? API;
  const minute = Math.floor((ports.now ?? Date.now)() / 60_000);
  /** @param {string} url */
  const json = async url => {
    const response = await read(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) { await response.body?.cancel(); return undefined; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`${url} answered ${response.status}`); }
    return response.json();
  };
  /** @param {string} url */
  const served = async url => {
    const response = await read(url, { method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    await response.body?.cancel();
    return response.ok;
  };
  /** @param {Channel} channel @param {string} build @param {string} hash @param {string} slug @param {string[]} from @returns {Promise<HeadRow>} */
  const checkHead = async (channel, build, hash, slug, from) => {
    const base = { channel, build, slug, hash, from };
    const index = /** @type {{slug?: string, loose?: string, keys?: string[]} | undefined} */ (await json(`${packs}index/${build}/${hash}.json?t=${minute}`));
    if (index === undefined) return { ...base, state: from.includes('placed') ? 'no-index' : 'uncooked' };
    const named = index.slug ?? slug, keys = new Set(index.keys), wanted = mapKeys(index.loose ?? '', named);
    const absent = wanted.filter(key => !keys.has(key));
    if (absent.length > 0) return { ...base, slug: named, state: 'no-map', detail: `index lists no ${absent.map(fileName).join(', ')}` };
    const unserved = [];
    for (const key of wanted) if (!await served(`${packs}${key}`)) unserved.push(fileName(key));
    return unserved.length > 0 ? { ...base, slug: named, state: 'map-404', detail: `store serves no ${unserved.join(', ')}` } : { ...base, slug: named, state: 'ok' };
  };
  const catalogue = /** @type {{shards: {slug: string, live?: {hash: string}, preview?: {hash: string}, channels?: {staging?: {raw?: string}}}[]}} */ (await json(`${api}/api/catalogue`));
  if (catalogue === undefined || !Array.isArray(catalogue.shards)) throw new Error('The catalogue has no shards');
  /** @type {HeadRow[]} */
  const rows = [];
  for (const channel of ports.channels ?? /** @type {const} */ (['production', 'staging'])) {
    const version = /** @type {{build?: unknown} | undefined} */ (await json(`${origins[channel]}/version.json`));
    const build = version?.build;
    if (typeof build !== 'string' || !/^[\w.-]{1,64}$/u.test(build)) throw new Error(`${channel} names no build`);
    /** @type {Map<string, {slug: string, from: Set<string>}>} */
    const heads = new Map();
    const add = (/** @type {string} */ slug, /** @type {unknown} */ hash, /** @type {string} */ from) => {
      if (typeof hash !== 'string' || !HEX.test(hash)) return;
      const head = heads.get(hash) ?? { slug, from: new Set() };
      head.from.add(from); heads.set(hash, head);
    };
    const signed = /** @type {{body?: unknown} | undefined} */ (await json(`${releases}${channel}-placements.json`));
    const placed = typeof signed?.body === 'string' ? /** @type {{cells?: {slug: string, hash?: string}[]}} */ (JSON.parse(signed.body)).cells ?? [] : [];
    for (const cell of placed) add(cell.slug.replace(/^_/u, ''), cell.hash, 'placed');
    for (const row of catalogue.shards) {
      add(row.slug, row.live?.hash, 'live'); add(row.slug, row.preview?.hash, 'preview'); add(row.slug, row.channels?.staging?.raw, 'staging');
    }
    rows.push(...await Promise.all([...heads].map(([hash, head]) => checkHead(channel, build, hash, head.slug, [...head.from]))));
  }
  return rows;
}

/** One line a head that is not ok, then a summary line a channel. @param {readonly HeadRow[]} rows @returns {string[]} */
export function auditLines(rows) {
  const lines = [];
  for (const channel of new Set(rows.map(row => row.channel))) {
    const mine = rows.filter(row => row.channel === channel), missing = mine.filter(row => MISSING.includes(row.state));
    for (const head of mine.filter(row => row.state !== 'ok').sort((a, b) => a.slug.localeCompare(b.slug)))
      lines.push(`${MISSING.includes(head.state) ? 'MISSING' : 'note   '} ${channel} ${head.slug} ${head.hash.slice(0, 12)} (${head.from.join('+')}): ${head.state}${head.detail === undefined ? '' : `, ${head.detail}`}`);
    lines.push(`${channel} build ${mine[0]?.build.slice(0, 12) ?? '?'}: ${mine.length} heads, ${mine.filter(row => row.state === 'ok').length} mapped, ${missing.length} missing a map, ${mine.filter(row => row.state === 'uncooked').length} not cooked for this build (no page of it reads them)`);
  }
  return lines;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), channels = /** @type {Channel[]} */ (args.flatMap((arg, at) => arg === '--channel' ? [args[at + 1]] : []));
  for (const channel of channels) if (channel !== 'production' && channel !== 'staging') throw new Error('usage: cooked-map-audit [--channel production|staging]... [--json]');
  const rows = await auditCookedMaps(channels.length === 0 ? {} : { channels });
  if (args.includes('--json')) console.log(JSON.stringify(rows, null, 2)); else for (const line of auditLines(rows)) console.log(line);
  const missing = rows.filter(row => MISSING.includes(row.state));
  if (missing.length > 0) { console.error(`cooked-map-audit: ${missing.length} head(s) missing a map: ${[...new Set(missing.map(row => `${row.channel}/${row.slug}`))].join(', ')}`); process.exit(1); }
}
