#!/usr/bin/env node
// Meta QA 11-25 row 64: a pin never moves a channel's head to a revision with no packs for a build that channel serves.
// Pine r18 and Driftwood r13 moved on staging after v0.1.91's cut with no packs for that build, read REV-BEHIND and could
// not be entered; on production that locks players out. FR-A17 checks every head at promotion; this checks the one head
// a pin moves, at pin time, against the build the channel serves a new page (the newest in its live deploy-chunks.json),
// read again on every pass so a deploy mid-wait counts. shard-pin.yml runs it before it writes the pin: it waits, bounded, for the cook (which takes
// an advertised head first, FR-A20), then refuses, naming each build still missing. ALLOW_MISSING_PACKS=1 is the J381
// hatch, as for FR-A17.
//
//   node scripts/pin-packs.mjs <slug> <hash> <staging|prod> [--wait=<minutes>]
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {agentFetch} from './agent-requests.mjs';
import {liveDeployBuilds} from './app-build/previousDeploy.mjs';

const PACKS = 'https://packs.wildshard.io';
/** A pin's channel, as the deploys and the page origins name it. */
const CHANNEL = Object.freeze({staging: {deploy: 'staging', origin: 'https://staging.wildshard.io'}, prod: {deploy: 'production', origin: 'https://play.wildshard.io'}});

/** @typedef {(url: string | URL, init?: RequestInit) => Promise<Response>} Fetch */

/**
 * Each served build with no exact-build pack index for the head, as `<build> <status>`.
 * @param {string} hash @param {readonly string[]} builds @param {string} origin @param {Fetch} [read] @returns {Promise<string[]>}
 */
export async function headPackGaps(hash, builds, origin, read = agentFetch) {
  if (!/^[0-9a-f]{64}$/u.test(hash)) throw new Error(`A pin's pack check needs the head's sha256, not ${hash}`);
  const rows = await Promise.all(builds.map(async build => {
    let status = 0;
    try {
      const index = await read(`${PACKS}/index/${build}/${hash}.json`, {
        cache: 'no-store', redirect: 'error', headers: {Origin: origin}, signal: AbortSignal.timeout(30_000)});
      status = index.status;
      await index.body?.cancel();
    } catch { status = 0; }
    return status === 200 ? undefined : `${build} ${status === 0 ? 'unread' : String(status)}`;
  }));
  return rows.filter(row => row !== undefined);
}

/** The build a pin's channel serves a new page now: its live deploy-chunks.json's newest build. The older builds it carries
 * only recover old tabs' code chunks; a head they lack packs for sends those tabs to the live build (a REV reload), and the
 * cook cooks for its own build only, so they never get a new head's packs. @param {'staging'|'prod'} channel
 * @param {Fetch} [read] @returns {Promise<string[]>} */
export async function servedBuilds(channel, read = agentFetch) {
  const {deploy, origin} = CHANNEL[channel];
  const [row] = await liveDeployBuilds(/** @type {typeof fetch} */ (read), {[deploy]: origin});
  return row?.builds.slice(0, 1) ?? [];
}

/**
 * Wait until the head has packs for every build the channel serves; refuse after `limitMs`, naming each missing build.
 * The served builds are read again on every pass: a release that starts serving a new build mid-wait is waited for too.
 * @param {{slug: string, hash: string, channel: 'staging'|'prod', log: (line: string) => void, read?: Fetch,
 *   builds?: () => Promise<string[]>, sleep?: (ms: number) => Promise<void>, now?: () => number, limitMs?: number, everyMs?: number}} options
 */
export async function waitForHeadPacks({slug, hash, channel, log, read = agentFetch, builds, sleep = async ms => { await delay(ms); },
  now = Date.now, limitMs = 40 * 60_000, everyMs = 60_000}) {
  const start = now(), served = builds ?? (() => servedBuilds(channel, read));
  for (;;) {
    const list = await served();
    if (list.length === 0) throw new Error(`${channel} serves no build: a pin cannot be checked against it`);
    const missing = await headPackGaps(hash, list, CHANNEL[channel].origin, read);
    if (missing.length === 0) {
      log(`PASS ${slug} ${hash.slice(0, 8)} has packs for every build ${channel} serves (${list.map(build => build.slice(0, 10)).join(', ')})`);
      return;
    }
    const waited = now() - start;
    if (waited >= limitMs) {
      throw new Error(`pin refused: ${slug} ${hash.slice(0, 8)} has no packs for ${missing.length} build(s) ${channel} serves after `
        + `${Math.round(waited / 60_000)} min: ${missing.join(', ')}. Moving it would leave the zone unenterable (REV-BEHIND, QA 11-25 row 64); `
        + 'the cook takes an advertised head first (FR-A20). ALLOW_MISSING_PACKS=1 (J381, named in the run) pins anyway');
    }
    log(`waiting: ${slug} ${hash.slice(0, 8)} has no packs yet for ${missing.join(', ')} (${Math.round(waited / 60_000)} min)`);
    await sleep(everyMs);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [slug = '', hash = '', channel = ''] = process.argv.slice(2);
  const wait = process.argv.find(arg => arg.startsWith('--wait='));
  if (channel !== 'staging' && channel !== 'prod') {
    console.error('usage: node scripts/pin-packs.mjs <slug> <hash> <staging|prod> [--wait=<minutes>]');
    process.exitCode = 2;
  } else if (process.env.ALLOW_MISSING_PACKS === '1') {
    console.log(`ALLOW_MISSING_PACKS=1 (J381): ${slug} ${hash.slice(0, 8)} pins without the pack check`);
  } else {
    await waitForHeadPacks({slug, hash, channel, log: line => { console.log(line); }, limitMs: Number(wait?.slice(7) ?? '0') * 60_000})
      .catch((/** @type {unknown} */ error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
  }
}
