#!/usr/bin/env node
// FAST-RELEASE FR-A17 (meta QA 11-25 row 35): a zone whose packs are not cooked for the page's build sent the shell
// into a reload loop (76 reloads in 90 s, then black) until engine ee1bef52a. A production alias move must never put
// a build on play before every head production advertises has its exact-build pack index, whatever the client does
// with a missing one. This reads production's catalogue and each head's `index/<build>/<hash>.json` with play's Origin.
//
// FR-A19 (the planner, 11-25): staging QA toured v0.1.89 and v0.1.90 into 404 packs mid-recook and held both releases.
// A staging deploy now waits, bounded, for every head staging advertises before its smoke and zone tour.
//
//   node src/scripts/page-release/production-packs.mjs <build sha> [--channel=staging] [--wait=<minutes>]
//   one read (exit 1 and the missing heads if any), or a wait of at most <minutes> for all of them
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {agentFetch} from '../agent-requests.mjs';

export const PRODUCTION_CATALOGUE = 'https://api.wildshard.io/api/catalogue.json?channel=production';
const PACKS = 'https://packs.wildshard.io';
/** Each channel's catalogue and the page origin its pack reads carry. */
const CHANNEL = Object.freeze({
  production: {catalogue: PRODUCTION_CATALOGUE, origin: 'https://play.wildshard.io'},
  staging: {catalogue: 'https://api.wildshard.io/api/catalogue.json?channel=staging', origin: 'https://staging.wildshard.io'},
});
/** FR-A19: how long a staging deploy waits for the cook before it holds (a full recook took about 40 min on 11-25). */
export const PACK_WAIT_MS = 45 * 60_000;

/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} Fetch */

/**
 * Each head a channel advertises whose exact-build pack index does not answer 200, as `<slug> <status>`.
 * @param {string} build @param {'production'|'staging'} channel @param {Fetch} [read]
 * @returns {Promise<string[]>}
 */
export async function missingPacks(build, channel, read = agentFetch) {
  if (!/^[0-9a-f]{40}$/u.test(build)) throw new Error(`A ${channel} pack check needs a full build SHA, not ${build}`);
  const {catalogue: url, origin} = CHANNEL[channel];
  const response = await read(url, {cache: 'no-store', signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new Error(`The ${channel} catalogue answered ${response.status}`);
  /** @type {{shards?: {slug?: unknown, hash?: unknown}[]}} */
  const catalogue = await response.json();
  const heads = (catalogue.shards ?? []).filter(head => typeof head.slug === 'string' && typeof head.hash === 'string');
  if (heads.length === 0) throw new Error(`${channel} advertises no heads`);
  const rows = await Promise.all(heads.map(async head => {
    let status = 0;
    try {
      const index = await read(`${PACKS}/index/${build}/${String(head.hash)}.json`, {
        cache: 'no-store', redirect: 'error', headers: {Origin: origin}, signal: AbortSignal.timeout(30_000)});
      status = index.status;
      await index.body?.cancel();
    } catch { status = 0; }
    return status === 200 ? undefined : `${String(head.slug)} ${status === 0 ? 'unread' : status}`;
  }));
  return rows.filter(row => row !== undefined);
}

/** Production's missing heads (FR-A17). @param {string} build @param {Fetch} [read] */
export const missingProductionPacks = (build, read) => missingPacks(build, 'production', read);

/**
 * FR-A19: wait until every head the channel advertises has packs for the build; throw with the missing heads after `limitMs`.
 * @param {string} build @param {'production'|'staging'} channel
 * @param {{log: (line: string) => void, read?: Fetch, sleep?: (ms: number) => Promise<void>, now?: () => number, limitMs?: number, everyMs?: number}} opts
 */
export async function waitForPacks(build, channel, {log, read = agentFetch, sleep = async ms => { await delay(ms); },
  now = Date.now, limitMs = PACK_WAIT_MS, everyMs = 60_000}) {
  const start = now();
  for (;;) {
    const missing = await missingPacks(build, channel, read);
    if (missing.length === 0) {
      log(`PASS ${channel} packs: every advertised head has index/${build} after ${Math.round((now() - start) / 1000)} s`);
      return;
    }
    const waited = now() - start;
    if (waited >= limitMs) {
      throw new Error(`${channel} packs for ${build} still missing on ${missing.length} head(s) after ${Math.round(waited / 60_000)} min: ${missing.slice(0, 8).join(', ')} (FR-A19: the cook has not finished)`);
    }
    log(`waiting: ${channel} packs for ${build.slice(0, 10)} missing on ${missing.length} head(s): ${missing.slice(0, 4).join(', ')}`);
    await sleep(everyMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const build = process.argv[2] ?? '';
  const channel = process.argv.includes('--channel=staging') ? 'staging' : 'production';
  const wait = process.argv.find(arg => arg.startsWith('--wait='));
  if (wait !== undefined) {
    await waitForPacks(build, channel, {log: line => console.log(line), limitMs: Number(wait.slice(7)) * 60_000})
      .catch((/** @type {unknown} */ error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
  } else {
    const missing = await missingPacks(build, channel);
    if (missing.length > 0) {
      console.error(`${channel} packs for ${build}: ${missing.length} head(s) missing: ${missing.join(', ')}`);
      process.exitCode = 1;
    } else console.log(`PASS ${channel} packs ${build}: every advertised head has its exact-build index`);
  }
}
