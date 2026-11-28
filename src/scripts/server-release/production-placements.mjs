// Meta QA 11-28 (fix-preview PV32, opus-ship): production's placed zones (the grid cells the API places, not the release
// file's shards) stayed one revision behind staging after v0.1.101, and shard-format v0.82.9's corpus refused the old
// Mossgate and Mirror Salt. Placed zones reach production only by a production flip, and the flip token lives only in
// GitHub secrets, so `production-placements.yml` runs this: for each slug it is given, it flips production's pointer to
// the hash staging's signed placement file places, then reads production's placement file again and fails unless every
// named slug matches staging. The release lane owns it (engine docs/server-release.md).
//
//   PRODUCTION_FLIP_TOKEN=... node src/scripts/server-release/production-placements.mjs --slugs mossgate,mirror-salt
//   node src/scripts/server-release/production-placements.mjs --slugs mossgate --check   no token: list moves, exit 1 if any
//
// Every read and write carries the Wildshard agent marker (src/scripts/agent-requests.mjs).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { agentFetch } from '../agent-requests.mjs';
import { API, RELEASES } from './production-pointers.mjs';

const HASH = /^[0-9a-f]{64}$/u;
const SLUG = /^[a-z0-9][a-z0-9-]*$/u;

/** @typedef {{slug: string, hash: string, shardVersion?: string}} PlacedCell */
/** @typedef {{slug: string, from: string | undefined, to: string, shardVersion: string | undefined}} PlacementMove */
/** @typedef {{fetch?: typeof fetch, api?: string, releases?: string, token?: string, log?: (line: string) => void}} PlacementDeps */

/** The cells a signed placement file places, for `channel`. @param {unknown} signed @param {string} channel @returns {PlacedCell[]} */
export function placedCells(signed, channel) {
  const body = typeof signed === 'object' && signed !== null && 'body' in signed && typeof signed.body === 'string' ? JSON.parse(signed.body) : undefined;
  if (body?.channel !== channel || !Array.isArray(body.cells)) throw new Error(`${channel}-placements.json is not a signed ${channel} placement file`);
  return body.cells;
}

/** The flips that put each named slug on staging's placed hash; a slug staging does not place refuses.
 * @param {readonly string[]} slugs @param {readonly PlacedCell[]} staging @param {readonly PlacedCell[]} production
 * @returns {PlacementMove[]} */
export function placementMoves(slugs, staging, production) {
  if (slugs.length === 0) throw new Error('name the placed slugs to promote (--slugs a,b)');
  /** @type {PlacementMove[]} */
  const moves = [];
  for (const slug of slugs) {
    if (!SLUG.test(slug)) throw new Error(`${slug}: not a shard slug`);
    const want = staging.find(cell => cell.slug === slug);
    if (want === undefined || !HASH.test(want.hash)) throw new Error(`${slug}: staging places no such zone, so there is nothing to promote`);
    const have = production.find(cell => cell.slug === slug);
    if (have?.hash === want.hash) continue;
    moves.push({ slug, from: have?.hash, to: want.hash, shardVersion: want.shardVersion });
  }
  return moves;
}

/** @param {typeof fetch} get @param {string | URL} url @param {RequestInit} [init] @returns {Promise<any>} */
async function json(get, url, init) {
  const answer = await get(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!answer.ok) throw new Error(`${init?.method ?? 'GET'} ${String(url)}: HTTP ${answer.status} ${(await answer.text()).slice(0, 200)}`);
  return await answer.json();
}

/** Read both placement files and answer the moves still owed. @param {readonly string[]} slugs @param {PlacementDeps} deps */
export async function readPlacementMoves(slugs, deps = {}) {
  const get = deps.fetch ?? agentFetch, releases = deps.releases ?? RELEASES;
  const [staging, production] = await Promise.all(['staging', 'production'].map(channel =>
    json(get, `${releases}/${channel}-placements.json`, { cache: 'no-store' }).then(signed => placedCells(signed, channel))));
  return placementMoves(slugs, staging ?? [], production ?? []);
}

/** Flip each named slug's production pointer to staging's placed hash, then verify none is left.
 * @param {readonly string[]} slugs @param {PlacementDeps} deps @returns {Promise<PlacementMove[]>} the moves made */
export async function promotePlacements(slugs, deps = {}) {
  const get = deps.fetch ?? agentFetch, api = deps.api ?? API, log = deps.log ?? console.log;
  if (deps.token === undefined || deps.token.length < 16) throw new Error('PRODUCTION_FLIP_TOKEN is not set: production placements left as they are');
  const moves = await readPlacementMoves(slugs, deps);
  for (const move of moves) {
    await json(get, new URL('/api/channels/production/flip', api), {
      method: 'POST', headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: move.slug, hash: move.to }),
    });
    log(`production placement ${move.slug}: ${move.from?.slice(0, 12) ?? '-'} -> ${move.to.slice(0, 12)} (${move.shardVersion ?? '?'})`);
  }
  const left = await readPlacementMoves(slugs, deps);
  if (left.length > 0) throw new Error(`production placements still off staging: ${left.map(move => move.slug).join(', ')}`);
  log(`production places ${slugs.join(', ')} as staging does (${moves.length} moved)`);
  return moves;
}

async function main() {
  const { values } = parseArgs({ options: { slugs: { type: 'string', default: '' }, check: { type: 'boolean', default: false } } });
  const slugs = values.slugs.split(',').map(slug => slug.trim()).filter(slug => slug !== '');
  if (values.check) {
    const moves = await readPlacementMoves(slugs);
    for (const move of moves) console.log(`owed ${move.slug}: ${move.from?.slice(0, 12) ?? '-'} -> ${move.to.slice(0, 12)} (${move.shardVersion ?? '?'})`);
    if (moves.length > 0) process.exitCode = 1;
    else console.log(`production places ${slugs.join(', ')} as staging does`);
    return;
  }
  await promotePlacements(slugs, { token: process.env.PRODUCTION_FLIP_TOKEN });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'production placement move failed'); process.exitCode = 1; }
}
