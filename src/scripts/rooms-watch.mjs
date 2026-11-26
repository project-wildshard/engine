#!/usr/bin/env node
// FAST-RELEASE FR-A15 part 3 (meta QA 11-25 row 31): the outside alarm that reaches an agent. On 11-25 both rooms hosts
// answered Cloudflare 521 from 10:11 UTC for over an hour; Sentry's uptime monitor raised WILDSHARD-GAME-86 at 10:13, but
// its only alert rules mail Jake and no agent polls Sentry (J252's hourly tick no longer runs), so nobody acted on it.
// This poller reads both public rooms /up URLs (agent-marked by user agent only: Caddy's `rewrite * /health` keeps a
// query, and the server answers `/health?agent=` with 404, so `?agent=` would read every host as 503) and, with a Sentry token, the open outage-category issues.
// A host down on two reads in a row, or a newly open outage issue, writes `NOTE RED builder: ...` to the receipts and
// `hc send`s it to the builder's terminal (main-watch's lookup); a host back gives one `rooms back` line. It never pages
// Jake: phone, mail and Signal routing are his call. The disabled Sentry monitors stay off (one free uptime seat).
//
//   node src/scripts/rooms-watch.mjs --once       one read (the LaunchAgent runs this every 60 s)
//   node src/scripts/rooms-watch.mjs --install    MacBook only, from the landed canonical checkout: the 60 s LaunchAgent
import {execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {agentFetch} from './agent-requests.mjs';
import {BUILDER_LABEL} from './main-watch.mjs';

export const ROOMS = Object.freeze(['https://rooms.wildshard.io/up', 'https://rooms-staging.wildshard.io/up']);
/** Reads in a row a host must fail before it is called down (one 60 s flap is not an outage). */
export const DOWN_AFTER = 2;
const SENTRY_ISSUES = 'https://sentry.io/api/0/organizations/wildshard/issues/?statsPeriod=24h&query=';
const OUTAGE_QUERY = 'is:unresolved issue.category:outage';
const LABEL = 'io.wildshard.rooms-watch';

/** @typedef {{fails: Record<string, number>, downSince: Record<string, number>, outages: string[]}} WatchState */
/** @typedef {{rooms: {url: string, status: number}[], outages?: {id: string, shortId: string, title: string}[]}} WatchRead */

/** @returns {WatchState} */
export const emptyState = () => ({fails: {}, downSince: {}, outages: []});
const clock = (/** @type {number} */ at) => `${new Date(at).toISOString().slice(11, 16)} UTC`;

/**
 * One poll: the next state and the lines to report. Pure, so the tests drive it.
 * @param {WatchState} state @param {WatchRead} read @param {number} now
 * @returns {{state: WatchState, lines: string[]}}
 */
export function step(state, read, now) {
  /** @type {WatchState} */
  const next = {fails: {...state.fails}, downSince: {...state.downSince}, outages: [...state.outages]};
  /** @type {string[]} */
  const lines = [];
  for (const {url, status} of read.rooms) {
    if (status === 200) {
      const since = next.downSince[url];
      if (since !== undefined) lines.push(`rooms back ${url} 200 after ${Math.round((now - since) / 60_000)} min down`);
      delete next.fails[url]; delete next.downSince[url];
      continue;
    }
    const fails = (next.fails[url] ?? 0) + 1;
    next.fails[url] = fails;
    if (fails === DOWN_AFTER) {
      const since = now - (DOWN_AFTER - 1) * 60_000;
      next.downSince[url] = since;
      lines.push(`NOTE RED builder: rooms ${url} answered ${status === 0 ? 'nothing' : status} on ${DOWN_AFTER} reads since ${clock(since)} (FR-A15; box: systemctl status caddy, journalctl -u caddy)`);
    }
  }
  if (read.outages !== undefined) {
    const open = new Set(read.outages.map(issue => issue.id));
    for (const issue of read.outages) {
      if (!next.outages.includes(issue.id)) lines.push(`NOTE RED builder: Sentry outage ${issue.shortId} open: ${issue.title.slice(0, 120)}`);
    }
    next.outages = [...open].sort();
  }
  return {state: next, lines};
}

/** The 60 s LaunchAgent, running `--once` from the canonical checkout. @param {string} root @param {string} home */
export function watchPlist(root, home) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array><string>${home}/.nvm/nvm-exec</string><string>node</string><string>${root}/scripts/rooms-watch.mjs</string><string>--once</string></array>
<key>EnvironmentVariables</key><dict><key>NODE_VERSION</key><string>default</string></dict>
<key>WorkingDirectory</key><string>${root}</string>
<key>StandardErrorPath</key><string>${home}/.cache/wildshard/rooms-watch.log</string>
<key>StartInterval</key><integer>60</integer><key>RunAtLoad</key><true/>
</dict></plist>
`;
}

/** @param {string} home @returns {string|undefined} */
function sentryToken(home) {
  const fromEnv = (process.env.SENTRY_AUTH_TOKEN ?? '').trim();
  if (fromEnv !== '') return fromEnv;
  const file = join(home, '.config/wildshard/sentry-auth-token');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() || undefined : undefined;
}

/** @param {string} url @returns {Promise<number>} */
async function readStatus(url) {
  try { return (await agentFetch(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15_000)})).status; }
  catch { return 0; }
}

/** @param {string|undefined} token @returns {Promise<WatchRead['outages']>} */
async function outages(token) {
  if (token === undefined) return undefined;
  try {
    const response = await fetch(`${SENTRY_ISSUES}${encodeURIComponent(OUTAGE_QUERY)}`, {headers: {authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)});
    if (!response.ok) return undefined;
    /** @type {{id: unknown, shortId: unknown, title: unknown}[]} */
    const issues = await response.json();
    return issues.map(({id, shortId, title}) => ({id: `${id}`, shortId: `${shortId}`, title: `${title}`}));
  } catch { return undefined; }
}

/** @param {string} home */
function builder(home) {
  if (process.env.WS_MAIN_WATCH_BUILDER) return process.env.WS_MAIN_WATCH_BUILDER;
  try {
    /** @type {{address?: string, state?: string}[]} */
    const terminals = JSON.parse(execFileSync('hc', ['ls', '--json', '--label', BUILDER_LABEL], {encoding: 'utf8', cwd: home})).terminals ?? [];
    return terminals.find(row => row.state === undefined || row.state === 'live')?.address;
  } catch { return undefined; }
}

/** @param {string[]} args */
export async function main(args) {
  if (args.length !== 1 || !['--once', '--install'].includes(args[0] ?? '')) throw new Error('Usage: rooms-watch.mjs --once|--install');
  const root = resolve(import.meta.dirname, '..', '..'), home = homedir();
  if (args[0] === '--install') {
    if (process.platform !== 'darwin') throw new Error('The rooms watch installs only on the MacBook');
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: root, encoding: 'utf8'}).trim();
    if (dirname(common) !== root) throw new Error('Install only from the landed canonical checkout');
    const folder = join(home, 'Library/LaunchAgents'), file = join(folder, `${LABEL}.plist`), domain = `gui/${process.getuid?.()}`;
    mkdirSync(folder, {recursive: true}); writeFileSync(file, watchPlist(root, home));
    execFileSync('plutil', ['-lint', file], {stdio: 'ignore'});
    try { execFileSync('launchctl', ['print', `${domain}/${LABEL}`], {stdio: 'ignore'}); }
    catch { execFileSync('launchctl', ['bootstrap', domain, file], {stdio: 'ignore'}); }
    console.log(`Installed ${LABEL}: both rooms /up and Sentry outage issues every 60 s`);
    return;
  }
  const stateFile = join(home, '.cache/wildshard/rooms-watch.json'), receipts = join(home, '.cache/wildshard/lane-receipts.log');
  /** @type {WatchState} */
  let state = emptyState();
  try { state = {...emptyState(), ...JSON.parse(readFileSync(stateFile, 'utf8'))}; } catch { /* first run */ }
  const now = Date.now();
  const read = {rooms: await Promise.all(ROOMS.map(async url => ({url, status: await readStatus(url)}))), outages: await outages(sentryToken(home))};
  const result = step(state, read, now);
  mkdirSync(dirname(stateFile), {recursive: true});
  writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(result.state)}\n`); renameSync(`${stateFile}.tmp`, stateFile);
  const terminal = result.lines.length === 0 ? undefined : builder(home);
  for (const line of result.lines) {
    appendFileSync(receipts, `${clock(now)} rooms-watch ${line}\n`);
    if (terminal !== undefined) try { execFileSync('hc', ['send', terminal, `rooms-watch: ${line}`], {stdio: 'ignore'}); } catch { /* the receipt stands */ }
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
