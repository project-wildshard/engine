// Meta QA 11-25 row 127 (opus-zs11, from ZONE-SNAPSHOTS ZS11): promoting v0.1.92 wrote releases/production.json but left
// six of the API's production pointers one release behind, and the API's daily prune keeps three revisions behind every
// pointer, so stale pointers held eight dead uploads. server-release.yml runs this right after it signs production's file:
// it reads the signed file the players load, maps each entry to its upload hash, and moves each production pointer that
// differs with the API's production flip, then reads the catalogue again and fails unless every entry matches.
// Meta QA 11-25 row 135: it flips with PRODUCTION_FLIP_TOKEN, which the API takes on POST /api/channels/production/flip
// and refuses everywhere else; the full ADMIN_TOKEN is in no GitHub secret.
//
//   PRODUCTION_FLIP_TOKEN=... node src/scripts/server-release/production-pointers.mjs move, then verify
//   node src/scripts/server-release/production-pointers.mjs --check                   no token: list moves, exit 1 if any
//
// Every read and write carries the Wildshard agent marker (src/scripts/agent-requests.mjs).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { agentFetch } from '../agent-requests.mjs';

export const API = 'https://api.wildshard.io';
export const RELEASES = 'https://releases.wildshard.io';
const HASH = /^[0-9a-f]{64}$/u;

/** @typedef {{slug: string, revision?: number, hash?: string}} ReleaseEntry */
/** @typedef {{slug: string, from: number | undefined, to: number, hash: string}} PointerMove */
/** @typedef {{fetch?: typeof fetch, api?: string, packs?: string, token?: string, log?: (line: string) => void}} PointerDeps */

/** @param {typeof fetch} get @param {string | URL} url @param {RequestInit} [init] @returns {Promise<any>} */
async function json(get, url, init) {
  const answer = await get(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!answer.ok) throw new Error(`${init?.method ?? 'GET'} ${String(url)}: HTTP ${answer.status} ${(await answer.text()).slice(0, 200)}`);
  return await answer.json();
}

/** The entries production's signed release file names (the file players load). @param {unknown} signed @returns {ReleaseEntry[]} */
export function releaseEntries(signed) {
  const body = typeof signed === 'object' && signed !== null && 'body' in signed && typeof signed.body === 'string' ? JSON.parse(signed.body) : undefined;
  if (body?.channel !== 'production' || !Array.isArray(body.shards)) throw new Error('releases/production.json is not a signed production release');
  return body.shards;
}

/** The moves that put production's pointers on the release file: one per entry whose pointer names another upload.
 *  An entry the API's list can't map to an upload refuses, since nothing would keep it.
 * @param {readonly ReleaseEntry[]} entries
 * @param {readonly {hash: string, revisions: readonly {shard: string, revision: number}[]}[]} listed  GET /api/shardfiles
 * @param {readonly {slug: string, live?: {revision: number, hash: string}}[]} catalogue  GET /api/catalogue, `live` is production's pointer
 * @returns {PointerMove[]} */
export function pointerMoves(entries, listed, catalogue) {
  /** @type {Map<string, string>} */
  const byRevision = new Map();
  for (const file of listed) for (const named of file.revisions) byRevision.set(`${named.shard}@${named.revision}`, file.hash);
  const live = new Map(catalogue.map(shard => [shard.slug, shard.live]));
  /** @type {PointerMove[]} */
  const moves = [];
  for (const entry of entries) {
    const hash = entry.hash ?? byRevision.get(`${entry.slug}@${entry.revision}`);
    if (hash === undefined || !HASH.test(hash)) throw new Error(`${entry.slug} r${entry.revision}: the API lists no upload for this release entry`);
    const pointer = live.get(entry.slug);
    if (pointer?.hash === hash) continue;
    const to = entry.revision ?? listed.find(file => file.hash === hash)?.revisions.find(named => named.shard === entry.slug)?.revision;
    if (to === undefined) throw new Error(`${entry.slug} ${hash.slice(0, 12)}: no revision for this hash`);
    moves.push({ slug: entry.slug, from: pointer?.revision, to, hash });
  }
  return moves;
}

/** Read the release file, the API's list and its catalogue, and answer the moves still owed. @param {PointerDeps} deps */
export async function readMoves(deps = {}) {
  const get = deps.fetch ?? agentFetch, api = deps.api ?? API, packs = deps.packs ?? RELEASES;
  const [signed, listed, catalogue] = await Promise.all([
    json(get, `${packs}/production.json`, { cache: 'no-store' }),
    json(get, new URL('/api/shardfiles', api)),
    json(get, new URL('/api/catalogue', api)),
  ]);
  return pointerMoves(releaseEntries(signed), listed.shardfiles, catalogue.shards);
}

/** Move every production pointer the release file disagrees with, then verify none is left. @param {PointerDeps} deps
 * @returns {Promise<PointerMove[]>} the moves made */
export async function alignProductionPointers(deps = {}) {
  const get = deps.fetch ?? agentFetch, api = deps.api ?? API, log = deps.log ?? console.log;
  if (deps.token === undefined || deps.token.length < 16) throw new Error('PRODUCTION_FLIP_TOKEN is not set: production pointers left as they are');
  const moves = await readMoves(deps);
  for (const move of moves) {
    await json(get, new URL('/api/channels/production/flip', api), {
      method: 'POST', headers: { authorization: `Bearer ${deps.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: move.slug, hash: move.hash }),
    });
    log(`production pointer ${move.slug}: r${move.from ?? '-'} -> r${move.to} (${move.hash.slice(0, 12)})`);
  }
  const left = await readMoves(deps);
  if (left.length > 0) throw new Error(`production pointers still off the release file: ${left.map(move => `${move.slug} r${move.from ?? '-'} for r${move.to}`).join(', ')}`);
  log(`production pointers match releases/production.json (${moves.length} moved)`);
  return moves;
}

async function main() {
  const { values } = parseArgs({ options: { check: { type: 'boolean', default: false } } });
  if (values.check) {
    const moves = await readMoves();
    for (const move of moves) console.log(`owed ${move.slug}: r${move.from ?? '-'} -> r${move.to}`);
    if (moves.length > 0) process.exitCode = 1;
    else console.log('production pointers match releases/production.json');
    return;
  }
  await alignProductionPointers({ token: process.env.PRODUCTION_FLIP_TOKEN });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'production pointer move failed'); process.exitCode = 1; }
}
