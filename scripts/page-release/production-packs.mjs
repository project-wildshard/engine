#!/usr/bin/env node
// FAST-RELEASE FR-A17 (meta QA 11-25 row 35): a zone whose packs are not cooked for the page's build sent the shell
// into a reload loop (76 reloads in 90 s, then black) until engine ee1bef52a. A production alias move must never put
// a build on play before every head production advertises has its exact-build pack index, whatever the client does
// with a missing one. This reads production's catalogue and each head's `index/<build>/<hash>.json` with play's Origin.
//
//   node scripts/page-release/production-packs.mjs <build sha>     one read; exit 1 and the missing heads if any
import {pathToFileURL} from 'node:url';
import {agentFetch} from '../agent-requests.mjs';

export const PRODUCTION_CATALOGUE = 'https://api.wildshard.io/api/catalogue.json?channel=production';
const PACKS = 'https://packs.wildshard.io';
const PLAY = 'https://play.wildshard.io';

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} Fetch */

/**
 * Each head production advertises whose exact-build pack index does not answer 200, as `<slug> <status>`.
 * @param {string} build @param {Fetch} [read]
 * @returns {Promise<string[]>}
 */
export async function missingProductionPacks(build, read = agentFetch) {
  if (!/^[0-9a-f]{40}$/u.test(build)) throw new Error(`A production pack check needs a full build SHA, not ${build}`);
  const response = await read(PRODUCTION_CATALOGUE, {cache: 'no-store', signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`Production catalogue answered ${response.status}`);
  /** @type {{shards?: {slug?: unknown, hash?: unknown}[]}} */
  const catalogue = await response.json();
  const heads = (catalogue.shards ?? []).filter(head => typeof head.slug === 'string' && typeof head.hash === 'string');
  if (heads.length === 0) throw new Error('Production advertises no heads');
  const rows = await Promise.all(heads.map(async head => {
    let status = 0;
    try {
      const index = await read(`${PACKS}/index/${build}/${String(head.hash)}.json`, {
        cache: 'no-store', redirect: 'error', headers: {Origin: PLAY}, signal: AbortSignal.timeout(30_000)});
      status = index.status;
      await index.body?.cancel();
    } catch { status = 0; }
    return status === 200 ? undefined : `${String(head.slug)} ${status === 0 ? 'unread' : status}`;
  }));
  return rows.filter(row => row !== undefined);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const build = process.argv[2] ?? '';
  const missing = await missingProductionPacks(build);
  if (missing.length > 0) {
    console.error(`production packs for ${build}: ${missing.length} head(s) missing: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else console.log(`PASS production packs ${build}: every advertised head has its exact-build index`);
}
