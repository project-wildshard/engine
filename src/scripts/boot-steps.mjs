#!/usr/bin/env node
// QA-FEEDBACK-2026-11-23 row 10 (meta): the last N real boots per device class, with their step times, so a slow boot on
// a phone (Jake's update boot on his iPhone 17 Pro) can be read. Each boot's summary carries its kind (first, update,
// normal) and steps (src/client/engine/telemetry/bootSteps.ts); api-server keeps them and answers
// GET /api/telemetry?boots=N&day=YYYY-MM-DD behind the review password. Agent-marked sessions are left out there.
//
//   WS_TELEMETRY_REVIEW_PASSWORD=... node src/scripts/boot-steps.mjs [--day YYYY-MM-DD] [--n 10] [--api https://api.wildshard.io] [--json]
//
// A session reports when it ends (the page hides) or at the next launch, so a boot shows up after that.
import { parseArgs } from 'node:util';
import { agentFetch } from './agent-requests.mjs';

/** The columns printed, in boot order; any other step is in --json. */
export const COLUMNS = ['page', 'home', 'homePrograms', 'shaders', 'finish', 'control'];

/** Times are said in Cancún (UTC-5, no DST). @param {string} iso */
export function cancun(iso) {
  const at = new Date(Date.parse(iso) - 5 * 3_600_000);
  return Number.isNaN(at.getTime()) ? iso : `${at.toISOString().slice(5, 16).replace('T', ' ')} Cancún`;
}

/** @param {number | undefined} ms */
const seconds = ms => ms === undefined ? '-' : (ms / 1000).toFixed(1);

/** One table per device class. @param {Readonly<Record<string, readonly {receivedAt: string; build: string; shard: string; boot: string; joinedMs?: number; steps: Readonly<Record<string, number>>}[]>>} boots */
export function bootTable(boots) {
  const lines = [];
  for (const [device, rows] of Object.entries(boots)) {
    lines.push(`${device} (${String(rows.length)} newest; seconds)`, ['when', 'build', 'kind', ...COLUMNS, 'joined'].join('\t'));
    for (const row of rows) lines.push([cancun(row.receivedAt), row.build.slice(0, 18), row.boot,
      ...COLUMNS.map(key => seconds(row.steps[key])), seconds(row.joinedMs)].join('\t'));
  }
  return lines.length === 0 ? 'no boots with step times that day' : lines.join('\n');
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { api: { type: 'string', default: 'https://api.wildshard.io' },
    day: { type: 'string', default: new Date().toISOString().slice(0, 10) }, n: { type: 'string', default: '10' }, json: { type: 'boolean' } } });
  const password = process.env.WS_TELEMETRY_REVIEW_PASSWORD;
  if (!password) throw new Error('Set WS_TELEMETRY_REVIEW_PASSWORD (the telemetry review password)');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(values.day)) throw new Error('--day is YYYY-MM-DD');
  const url = new URL('/api/telemetry', values.api);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('The review read needs HTTPS or loopback');
  url.searchParams.set('boots', values.n); url.searchParams.set('day', values.day);
  const response = await agentFetch(url, { headers: { 'x-review-password': password }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`boot read refused: HTTP ${String(response.status)}`);
  const body = await response.json();
  if (values.json) console.log(JSON.stringify(body, null, 2));
  else console.log(`${values.day}\n${bootTable(body.boots ?? {})}`);
}
