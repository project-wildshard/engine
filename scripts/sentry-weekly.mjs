#!/usr/bin/env node
// SENTRY-ZERO SZ7 (meta docs/plans/SENTRY-ZERO-PLAN.md; Jake, 2026-11-23: "Everything in sentry MUST be a bug, and it must be
// fixed and it must be low frequency"): the weekly check. Lists every unresolved issue over the low-frequency line (5 events a
// day by default) in the window, worst first, and exits 2 when there is one, so a cron or a lane sees it.
//
//   node scripts/sentry-weekly.mjs [--days 7] [--per-day 5] [--json <issues.json>]
//
// It reads Sentry's issues API with SENTRY_AUTH_TOKEN, else ~/.config/wildshard/sentry-auth-token (never printed). With no
// token it says so and exits 0. `--json` reads a saved issue list instead (the API's array, or the Sentry MCP's
// `search_issues` result with its `issues`), so an agent with the MCP and no token can run the same check.
import { readFileSync } from 'node:fs';
import { SENTRY_ORG, sentryToken } from './sentry-maps.mjs';

export const SENTRY_API = 'https://us.sentry.io/api/0';
export const DEFAULT_DAYS = 7;
export const DEFAULT_PER_DAY = 5;

/**
 * The issues over the line: more than `perDay` events a day on average over `days`. Takes the API's `count` (a string) or the
 * MCP's `occurrences`.
 * @param {readonly Record<string, unknown>[]} issues
 * @param {{days: number, perDay: number}} line
 * @returns {{id: string, title: string, events: number, perDay: number}[]}
 */
export function overLine(issues, { days, perDay }) {
  return issues.map((issue) => {
    const events = Number(issue['count'] ?? issue['occurrences'] ?? 0);
    return { id: String(issue['shortId'] ?? ''), title: String(issue['title'] ?? '').slice(0, 90), events, perDay: events / days };
  }).filter((row) => row.perDay > perDay).sort((a, b) => b.events - a.events);
}

/** @param {ReturnType<typeof overLine>} rows @param {{days: number, perDay: number}} line @returns {string} */
export function table(rows, { days, perDay }) {
  if (rows.length === 0) return `sentry-weekly: no unresolved issue over ${String(perDay)} events a day in ${String(days)} days`;
  return [`sentry-weekly: ${String(rows.length)} unresolved issue(s) over ${String(perDay)} events a day in ${String(days)} days`,
    '| Issue | Events | Per day | Title |', '|---|---|---|---|',
    ...rows.map((row) => `| ${row.id} | ${String(row.events)} | ${row.perDay.toFixed(1)} | ${row.title.replaceAll('|', '/')} |`)].join('\n');
}

/** @param {string[]} argv */
function parse(argv) {
  const value = (/** @type {string} */ flag) => { const at = argv.indexOf(flag); return at === -1 ? undefined : argv[at + 1]; };
  return { days: Number(value('--days') ?? DEFAULT_DAYS), perDay: Number(value('--per-day') ?? DEFAULT_PER_DAY), json: value('--json') };
}

async function main() {
  const { days, perDay, json } = parse(process.argv.slice(2));
  /** @type {Record<string, unknown>[]} */
  let issues;
  if (json !== undefined) {
    const read = /** @type {unknown} */ (JSON.parse(readFileSync(json, 'utf8')));
    issues = /** @type {Record<string, unknown>[]} */ (Array.isArray(read) ? read : (/** @type {{issues?: unknown}} */ (read).issues ?? []));
  } else {
    const token = sentryToken();
    if (token === '') { console.log('sentry-weekly: no SENTRY_AUTH_TOKEN and no ~/.config/wildshard/sentry-auth-token: nothing read'); return 0; }
    const url = `${SENTRY_API}/organizations/${SENTRY_ORG}/issues/?query=${encodeURIComponent('is:unresolved')}&statsPeriod=${String(days)}d&sort=freq&limit=100`;
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) { console.error(`sentry-weekly: Sentry answered ${String(response.status)}`); return 1; }
    issues = /** @type {Record<string, unknown>[]} */ (await response.json());
  }
  const rows = overLine(issues, { days, perDay });
  console.log(table(rows, { days, perDay }));
  return rows.length === 0 ? 0 : 2;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main();
