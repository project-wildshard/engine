// Meta QA-FEEDBACK-2026-11-23 row 6 (Jake, ~11:50 Cancún, J497 (5)): one admin command for the box's maintenance, so a
// recook or a cook check never waits on a release train. Each verb is a task agents did by hand or by release in the week
// to 11-23 (the inventory: meta project/evidence/qa-2026-11-23-finish3/row6-inventory.md):
//   node src/scripts/admin.mjs status [staging|production]   the cook's health, build and per-state tally since it started, and
//                                                         how many of the channel's catalogue heads have an index for that build
//   node src/scripts/admin.mjs log [-n 40]                    the cook worker's last journal lines
//   node src/scripts/admin.mjs recook <slug> <hash> [--revision N] [--wait S]
//                                                         ask the running cook for one exact head (its notify endpoint, as the
//                                                         API's upload notice does); a head already indexed for the cook's build
//                                                         answers `present` and costs nothing; --wait follows the journal for
//                                                         the head's verdict (default 0: queue and return)
//   node src/scripts/admin.mjs format [<channel> <X.Y.B.A> [--drop a,b]]
//                                                         no channel: the API's format (public); with one: re-run the channel's
//                                                         format move (api-server's admin PUT /api/channels/:channel/format,
//                                                         the publisher's step): it re-queues the missing migrate jobs, or
//                                                         answers 409 naming the originals that refuse
//   node src/scripts/admin.mjs probe <channel> | restart staging     src/scripts/box-ops.mjs's two verbs (MA7a), unchanged
// Everything goes over the agents' ssh alias `wildshard-agent` (box-ops.mjs's HOST): loopback reads, the cook's journal (the
// agents' account is in systemd-journal) and the loopback notify endpoint on 127.0.0.1:8792. The notify token is read from
// ~/.config/wildshard/cook.env (COOK_NOTIFY_TOKEN, or the environment) and reaches curl on the box's stdin, never an argv.
// `format` calls the API with ADMIN_TOKEN (the environment, else ~/.config/wildshard/api-server.env).
// Not here yet (a box change through a signed release): moving the cook to a tag (`sudo wildshard-config cook <tag>`, the
// release's step) and a rooms catalogue re-read.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {agentFetch} from './agent-requests.mjs';
import {HOST, main as boxOps, shq} from './box-ops.mjs';

export const COOK_UNIT = 'wildshard-cook';
export const COOK_URL = 'http://127.0.0.1:8792';
export const PACKS = 'https://packs.wildshard.io/', API = 'https://api.wildshard.io';
const SLUG = /^_?[a-z0-9][a-z0-9-]{0,62}$/u, HEX = /^[a-f0-9]{64}$/u, BUILD = /^[\w.-]{1,64}$/u;
/** The cook's verdicts for one head (`cookWorker.ts` logs `cook <slug> <hash12>: <state>`). */
export const STATES = ['cooked', 'present', 'carried', 'failed'];

/** The journal of the cook's current run only: its systemd invocation, so an older run's lines never count. */
export function journalCommand(lines = 0, sinceMs = 0) {
  const tail = lines > 0 ? ` -n ${String(Math.trunc(lines))}` : '';
  const since = sinceMs > 0 ? ` --since @${String(Math.floor(sinceMs / 1000))}` : '';
  return `journalctl _SYSTEMD_INVOCATION_ID="$(systemctl show -p InvocationID --value ${COOK_UNIT})" --no-pager -o short-iso${since}${tail}`;
}

export const healthCommand = () => `curl -s -m 10 ${COOK_URL}/health`;

/**
 * The tally a status prints from the current run's journal: the build it polls or recooks, and each head's last verdict.
 * @param {string} journal
 */
export function tallyJournal(journal) {
  /** @type {Map<string, {slug: string, hash12: string, state: string, at: string}>} */
  const heads = new Map();
  let build = '', started = '';
  for (const line of journal.split('\n')) {
    const at = /^(\S+)\s/u.exec(line)?.[1] ?? '';
    if (started === '' && at !== '' && !line.startsWith('--')) started = at;
    const named = /\b(?:poll|recook) ([\w.-]{1,64}):/u.exec(line);
    if (named?.[1] !== undefined) build = named[1];
    const verdict = /\bcook (\S+) ([a-f0-9]{12}): (cooked|present|carried|failed)\b/u.exec(line);
    if (verdict?.[1] !== undefined && verdict[2] !== undefined && verdict[3] !== undefined)
      heads.set(verdict[2], {slug: verdict[1], hash12: verdict[2], state: verdict[3], at});
  }
  const counts = Object.fromEntries(STATES.map(state => [state, [...heads.values()].filter(head => head.state === state).length]));
  return {build, started, counts, failed: [...heads.values()].filter(head => head.state === 'failed')};
}

/**
 * The notify call for one head. The body names no secret, so it may ride the command line; the bearer header comes from stdin.
 * @param {{slug: string, hash: string, revision: number}} head
 */
export function notifyCommand(head) {
  if (!SLUG.test(head.slug)) throw new Error(`'${head.slug}' is not a shard slug`);
  if (!HEX.test(head.hash)) throw new Error(`'${head.hash}' is not a 64-hex shardfile hash`);
  if (!Number.isInteger(head.revision) || head.revision < 1) throw new Error(`revision ${String(head.revision)} is not a revision number`);
  const body = JSON.stringify({event: 'shardfile.new', stage: 'preview', shard: head.slug, revision: head.revision, hash: head.hash});
  return `curl -s -m 20 -w '\\n%{http_code}' -X POST -H @- -H 'content-type: application/json' --data-binary ${shq(body)} ${COOK_URL}/notify`;
}

/** COOK_NOTIFY_TOKEN from the environment, else this Mac's cook.env (the copy the box's was set from). @param {NodeJS.ProcessEnv} env */
export function notifyToken(env = process.env, file = join(homedir(), '.config/wildshard/cook.env')) {
  if (env.COOK_NOTIFY_TOKEN) return env.COOK_NOTIFY_TOKEN;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { throw new Error(`no COOK_NOTIFY_TOKEN: set it or keep it in ${file}`); }
  const token = /^COOK_NOTIFY_TOKEN=(.+)$/mu.exec(text)?.[1]?.trim().replace(/^(['"])(.*)\1$/u, '$2') ?? '';
  if (token.length < 16) throw new Error(`${file} names no COOK_NOTIFY_TOKEN`);
  return token;
}

/** ADMIN_TOKEN from the environment, else this Mac's api-server.env. @param {NodeJS.ProcessEnv} env */
export function adminToken(env = process.env, file = join(homedir(), '.config/wildshard/api-server.env')) {
  if (env.ADMIN_TOKEN) return env.ADMIN_TOKEN;
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { throw new Error(`no ADMIN_TOKEN: set it or keep it in ${file}`); }
  const token = /^ADMIN_TOKEN=(.+)$/mu.exec(text)?.[1]?.trim().replace(/^(['"])(.*)\1$/u, '$2') ?? '';
  if (token.length < 16) throw new Error(`${file} names no ADMIN_TOKEN`);
  return token;
}

/** The format a channel move takes (api-server's FORMAT), and the channels a move can name. Preview is not one: it follows staging's
 * pointers and format, and the API answers a preview move with 409 (meta QA 11-26 rows 9 and 10). Move staging instead. */
const FORMAT = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})(?:\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3}))?$/u;
export const FORMAT_CHANNELS = new Set(['staging', 'production']);

/** @typedef {(command: string, input?: string) => string} Run */
/** @typedef {{shards: {slug: string, live?: {revision?: number, hash: string}, preview?: {revision?: number, hash: string}, channels?: Record<string, {raw?: string, revision?: number}>}[]}} Catalogue */

/** @param {typeof fetch} read @param {string} url */
async function json(read, url) {
  const response = await read(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
  if (!response.ok) { await response.body?.cancel(); throw new Error(`${url} answered ${response.status}`); }
  return response.json();
}

/** A channel's catalogue heads: production reads live and preview, staging its own pointer. @param {Catalogue} catalogue @param {string} channel */
export function channelHeads(catalogue, channel) {
  /** @type {Map<string, string>} */
  const heads = new Map();
  for (const row of catalogue.shards) {
    const hashes = channel === 'staging' ? [row.channels?.staging?.raw] : [row.live?.hash, row.preview?.hash];
    for (const hash of hashes) if (typeof hash === 'string' && HEX.test(hash)) heads.set(hash, row.slug);
  }
  return heads;
}

/** The revision the catalogue gives one head, or undefined. @param {Catalogue} catalogue @param {string} slug @param {string} hash */
export function revisionOf(catalogue, slug, hash) {
  const row = catalogue.shards.find(shard => shard.slug === slug.replace(/^_/u, ''));
  if (row === undefined) return undefined;
  for (const head of [row.live, row.preview, ...Object.values(row.channels ?? {}).map(channel => ({hash: channel.raw, revision: channel.revision}))])
    if (head?.hash === hash && Number.isInteger(head.revision)) return head.revision;
  return undefined;
}

/**
 * @param {string[]} argv
 * @param {{run?: Run, fetch?: typeof fetch, env?: NodeJS.ProcessEnv, sleep?: (ms: number) => Promise<void>, now?: () => number}} [ports]
 * @returns {Promise<unknown>}
 */
export async function main(argv, ports = {}) {
  const run = ports.run ?? ssh, read = ports.fetch ?? agentFetch;
  const [verb = '', ...rest] = argv;
  const option = (/** @type {string} */ name) => { const at = rest.indexOf(name); return at === -1 ? undefined : rest[at + 1]; };
  if (verb === 'probe' || verb === 'restart') return boxOps([verb, ...rest], command => run(command));
  if (verb === 'format') {
    if (rest.length === 0) return json(read, `${API}/api/format`);
    const [channel = '', format = ''] = rest, drop = option('--drop')?.split(',').filter(Boolean);
    if (channel === 'preview') throw new Error('preview follows staging: move staging (admin.mjs format staging <X.Y.B.A>)');
    if (!FORMAT_CHANNELS.has(channel) || !FORMAT.test(format)) throw new Error('usage: admin.mjs format [<staging|production> <X.Y.B.A> [--drop a,b]]');
    const response = await read(`${API}/api/channels/${channel}/format`, {method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(60_000),
      headers: {authorization: `Bearer ${adminToken(ports.env)}`, 'content-type': 'application/json'}, body: JSON.stringify(drop === undefined ? {format} : {format, drop})});
    const text = await response.text();
    /** @type {unknown} */
    let body = text;
    try { body = JSON.parse(text); } catch { /* a plain-text answer stays text */ }
    if (!response.ok) throw new Error(`the API answered ${String(response.status)}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    return {channel, format, status: response.status, answer: body};
  }
  if (verb === 'log') return run(journalCommand(Number(option('-n') ?? 40))).trimEnd();
  if (verb === 'status') {
    const channel = rest[0] ?? 'staging';
    if (channel !== 'staging' && channel !== 'production') throw new Error('usage: admin.mjs status [staging|production]');
    const health = /** @type {{ok?: boolean, rows?: number, failed?: number}} */ (JSON.parse(run(healthCommand()) || '{}'));
    const tally = tallyJournal(run(journalCommand()));
    if (!BUILD.test(tally.build)) throw new Error('the cook journal names no build since its start');
    const heads = channelHeads(/** @type {Catalogue} */ (await json(read, `${API}/api/catalogue`)), channel);
    const missing = [];
    for (const [hash, slug] of heads) {
      const response = await read(`${PACKS}index/${tally.build}/${hash}.json`, {method: 'HEAD', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
      await response.body?.cancel();
      if (!response.ok) missing.push(`${slug} ${hash.slice(0, 12)}`);
    }
    return {channel, cook: {healthy: health.ok === true, rows: health.rows, failed: health.failed, build: tally.build, since: tally.started, ...tally.counts},
      failedHeads: tally.failed.map(head => `${head.slug} ${head.hash12}`), indexed: `${heads.size - missing.length} of ${heads.size}`, notIndexed: missing};
  }
  if (verb === 'recook') {
    const [slug = '', hash = ''] = rest;
    let revision = option('--revision') === undefined ? undefined : Number(option('--revision'));
    revision ??= revisionOf(/** @type {Catalogue} */ (await json(read, `${API}/api/catalogue`)), slug, hash);
    if (revision === undefined) throw new Error(`the catalogue lists no revision for ${slug} ${hash.slice(0, 12)}: pass --revision N`);
    const command = notifyCommand({slug, hash, revision});
    const sleep = ports.sleep ?? (ms => new Promise(resolve => { setTimeout(resolve, ms); })), now = ports.now ?? Date.now;
    // Only a verdict logged after this notice answers it (a 5 s margin for the two clocks); an older line is a former run's.
    const asked = now() - 5_000;
    const answer = run(command, `Authorization: Bearer ${notifyToken(ports.env)}\n`).trimEnd().split('\n');
    const status = Number(answer.at(-1));
    if (status !== 202) throw new Error(`the cook answered ${String(status)}: ${answer.slice(0, -1).join(' ')}`);
    const wait = Number(option('--wait') ?? 0);
    const until = now() + wait * 1000;
    while (now() < until) {
      const verdict = new RegExp(`\\bcook \\S+ ${hash.slice(0, 12)}: (cooked|present|carried|failed)\\b.*$`, 'u');
      const last = run(journalCommand(400, asked)).split('\n').reverse().map(line => verdict.exec(line)).find(Boolean);
      if (last?.[1] !== undefined) return {queued: hash, slug, revision, state: last[1], line: last[0]};
      await sleep(10_000);
    }
    return {queued: hash, slug, revision, state: wait > 0 ? 'waiting' : 'queued'};
  }
  throw new Error('usage: admin.mjs status [staging|production] | log [-n N] | recook <slug> <hash> [--revision N] [--wait S] | format [<channel> <format>] | probe <channel> | restart staging');
}

/** @type {Run} */
function ssh(command, input) {
  const done = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, command], {encoding: 'utf8', input, maxBuffer: 1 << 26});
  if (done.status !== 0) {
    if (done.stderr) process.stderr.write(done.stderr);
    throw Object.assign(new Error(`ssh ${HOST} exited ${done.status ?? done.signal}`), {status: done.status});
  }
  return done.stdout;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = await main(process.argv.slice(2));
    console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
