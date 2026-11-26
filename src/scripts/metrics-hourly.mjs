// METRICS MT14. A read-only report on the same room summaries as /metrics.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { agentFetch } from './agent-requests.mjs';
import { apiOrigin } from './api-origin.mjs';

/**
 * @typedef {{channel: string, room: string, page: string}} Host
 * @typedef {{day: string, metric: string, actor: string, lane: string, slug: string, value: number}} DayRow
 * @typedef {{humans: number, agents: number}} Live
 * @typedef {{channel: string, rows: readonly DayRow[], current?: {live: Live, popular: readonly string[]}}} DashboardChannel
 * @typedef {{channels: readonly DashboardChannel[]}} Dashboard
 * @typedef {{count: number, dimensions?: {userAgent?: string}}} RequestGroup
 * @typedef {{seats: number, leaks: number, lanes: Readonly<Record<string, number>>}} Markers
 * @typedef {{channel: string, markers: Markers | null, requests: readonly RequestGroup[] | null}} Audit
 * @typedef {{summary: Dashboard | null, channels: readonly Audit[]}} Report
 */
const HOUR_MS = 3_600_000;
const DEADLINE_MS = 5_000;
const LEAK_FRACTION = .01;
const GQL_LIMIT = 1000;
const ROOMS = [
  { channel: 'staging', room: 'rooms-staging.wildshard.io', page: 'staging.wildshard.io' },
  { channel: 'production', room: 'rooms.wildshard.io', page: 'play.wildshard.io' },
];
const EDGE_QUERY = `query MarkerTraffic($zoneTag: string, $filter: ZoneHttpRequestsAdaptiveGroupsFilter_InputObject) {
  viewer { zones(filter: { zoneTag: $zoneTag }) {
    requests: httpRequestsAdaptiveGroups(filter: $filter, limit: ${GQL_LIMIT}, orderBy: [count_DESC]) {
      count dimensions { userAgent }
    }
  } }
}`;
const AGENT_UA = /\bWildshardAgent\/1(?:\s+\((?<lane>[\w.-]{1,64})\))?(?:\s|$)/iu;
const AUTOMATED_UA = /HeadlessChrome|Playwright|PhantomJS|^\s*(?:node|curl|undici)(?:[\s/]|$)/iu;
const UA_FILTER = ['%WildshardAgent/1%', '%HeadlessChrome%', '%Playwright%', '%PhantomJS%', 'node%', 'curl%', 'undici%'];
const EMPTY = '—';

/** @param {typeof fetch} read @param {string} url @param {RequestInit} [init] */
async function json(read, url, init = {}) {
  const response = await read(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(DEADLINE_MS) });
  if (!response.ok) throw new Error(`metrics HTTP ${response.status}`);
  return response.json();
}
/** @template T @param {() => Promise<T>} read @returns {Promise<T | null>} */
async function optional(read) {
  try { return await read(); } catch { return null; }
}
/** @param {Host} channel @param {NodeJS.ProcessEnv} env @param {number} now @returns {Promise<readonly RequestGroup[] | null>} */
async function edge(channel, env, now) {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ZONE_ID: zoneTag } = env;
  if (!token || !zoneTag) return null;
  const filter = {
    clientRequestHTTPHost: channel.page, requestSource: 'eyeball',
    datetime_geq: new Date(now - HOUR_MS).toISOString(), datetime_lt: new Date(now).toISOString(),
    OR: UA_FILTER.map(userAgent_like => ({ userAgent_like })),
  };
  const reply = await json(fetch, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: EDGE_QUERY, variables: { zoneTag, filter } }),
  });
  if (reply.errors?.length) return null;
  return reply.data?.viewer?.zones?.[0]?.requests ?? null;
}

/** @param {NodeJS.ProcessEnv} env @param {number} now @returns {Promise<Report>} */
async function collect(env, now) {
  const summary = optional(() => json(agentFetch, `${apiOrigin()}/api/metrics/summary?days=1`));
  const channels = ROOMS.map(async room => {
    const [markers, requests] = await Promise.all([
      optional(() => json(agentFetch, `https://${room.room}/metrics/markers`)),
      optional(() => edge(room, env, now)),
    ]);
    return { channel: room.channel, markers, requests };
  });
  return { summary: await summary, channels: await Promise.all(channels) };
}

/** @param {readonly RequestGroup[]} requests */
function uaCounts(requests) {
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const { count, dimensions } of requests) {
    const ua = dimensions?.userAgent ?? '';
    if (!Number.isFinite(count) || count <= 0) continue;
    const mark = AGENT_UA.exec(ua);
    if (mark === null && !AUTOMATED_UA.test(ua)) continue;
    const source = /HeadlessChrome/iu.test(ua) ? 'HeadlessChrome' : /Playwright/iu.test(ua) ? 'Playwright' :
      /^node\b/iu.test(ua) ? 'node' : /^curl\b/iu.test(ua) ? 'curl' : 'other automation';
    const lane = mark?.groups?.lane ?? EMPTY;
    const key = [source, mark === null ? 'missing' : 'marked', lane].join('\t');
    groups.set(key, (groups.get(key) ?? 0) + count);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, count]) => `${key}\t${count}`);
}

/** @param {readonly DayRow[]} rows @param {string} metric @param {string} actor */
function freshest(rows, metric, actor) {
  const matches = rows.filter(row => row.metric === metric && row.actor === actor && row.lane === '' && row.slug === '');
  return matches.sort((a, b) => b.day.localeCompare(a.day))[0]?.value ?? EMPTY;
}
/** @param {Dashboard | null} summary */
function headline(summary) {
  const body = ['Players and arrivals', 'channel\thumans now\tagents now\thuman DAU\tagent DAU\tPopular'];
  if (!Array.isArray(summary?.channels)) return [...body, 'unavailable'];
  for (const view of summary.channels) {
    const live = view.current?.live;
    body.push([view.channel, live?.humans ?? EMPTY, live?.agents ?? EMPTY,
      freshest(view.rows, 'dau', 'human'), freshest(view.rows, 'dau', 'agent'),
      view.current?.popular?.slice(0, 3).join(', ') ?? EMPTY].join('\t'));
  }
  return body;
}
/** @param {Markers | null} markers */
function leakReport(markers) {
  if (markers === null || markers === undefined) return ['Room marker check unavailable'];
  const { seats, leaks, lanes } = markers, ratio = seats > 0 ? leaks / seats : 0;
  const share = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 }).format(ratio);
  const body = [`Room marker check: ${leaks}/${seats} seats (${share})`];
  if (ratio > LEAK_FRACTION) body.push(`Marker leak over 1%: ${Object.entries(lanes).map(([lane, count]) => `${lane} (${count})`).join(', ')}`);
  return body;
}

/** @param {Report} report */
export function hourlyText({ summary, channels }) {
  const body = headline(summary);
  for (const { channel, markers, requests } of channels) {
    body.push('', `Cloudflare last hour (${channel})`, 'UA\tmarker\tlane\trequests');
    if (requests === null) body.push('unavailable');
    else {
      const counts = uaCounts(requests);
      body.push(...(counts.length === 0 ? ['none observed'] : counts));
      if (requests.length === GQL_LIMIT) body.push('Grouped rows reached the Cloudflare limit.');
    }
    body.push(...leakReport(markers));
  }
  return `${body.join('\n')}\n`;
}

async function main() {
  const [flag, path] = process.argv.slice(2);
  if (flag !== undefined && (flag !== '--fixture' || path === undefined)) throw new Error('usage: node src/scripts/metrics-hourly.mjs [--fixture <json>]');
  const input = path === undefined ? await collect(process.env, Date.now()) : JSON.parse(await readFile(path, 'utf8'));
  process.stdout.write(hourlyText(input));
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
