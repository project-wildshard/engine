// Meta MINI-AUTONOMY MA7a (D7): the box operations a workflow may run, so the Mac mini dispatches them and never holds a
// box key or SSHes to the box itself. `probe <channel>` is read-only: three loopback Prometheus queries (tick p95 per
// worker, resident memory, heap slope) over the agents' account. `restart staging` restarts the staging server unit
// through the agents' sudo allowlist (MS3.5, J266); any other channel is refused before anything connects.
//   node scripts/box-ops.mjs probe staging|production
//   node scripts/box-ops.mjs restart staging
// The host is the ssh alias `wildshard-agent` (this Mac's ~/.ssh/config, or the one box-probe.yml writes from secrets).
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const CHANNELS = ['staging', 'production'];
export const HOST = 'wildshard-agent';
// SC3's agent-read lines (engine docs/vps-setup.md): tick p95 over 12 ms, RSS over 60% of the unit cap.
export const TICK_P95_BUDGET_S = 0.012;
export const RSS_CAP_BYTES = {staging: 6 * 2 ** 30, production: 18 * 2 ** 30};
export const RSS_SHARE = 0.6;
const WINDOW = '10m';

/** @typedef {'staging' | 'production'} Channel */
/** @typedef {{status?: string, data?: {result?: unknown}}} PromAnswer */

/** @param {string} channel @returns {Channel} */
function known(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`unknown channel '${channel}': want staging or production`);
  return /** @type {Channel} */ (channel);
}

/** The three PromQL reads for one channel, each over the last 10 minutes. @param {string} channel */
export function probeQueries(channel) {
  const c = known(channel);
  return {
    tick: `max by (worker) (max_over_time(wildshard_tick_seconds{channel="${c}",quantile="0.95"}[${WINDOW}]))`,
    rss: `max(process_resident_memory_bytes{channel="${c}"})`,
    heapSlope: `sum(deriv(wildshard_thread_memory_bytes{channel="${c}",kind="heap"}[${WINDOW}]))`,
  };
}

/** POSIX single-quote a string for the remote shell. @param {string} text */
export function shq(text) {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** The remote command for one instant query: a loopback curl, nothing leaves the box. @param {string} query */
export function promCommand(query) {
  return `curl -s -m 15 --get --data-urlencode ${shq(`query=${query}`)} 127.0.0.1:9090/api/v1/query`;
}

/** Staging only: production is read-only from every workflow (MA7a). @param {string} channel */
export function restartCommand(channel) {
  if (channel !== 'staging') {
    throw new Error(`refused: only the staging server restarts from a workflow; '${channel}' is read-only (MA7a)`);
  }
  return 'sudo -n /usr/bin/systemctl restart wildshard-server@staging && systemctl is-active wildshard-server@staging';
}

/** @param {unknown} answer a Prometheus /api/v1/query body */
function rows(answer) {
  if (typeof answer !== 'object' || answer === null || /** @type {any} */ (answer).status !== 'success') {
    throw new Error('Prometheus did not answer success');
  }
  const result = /** @type {any} */ (answer).data?.result;
  if (!Array.isArray(result)) throw new Error('Prometheus answer has no result list');
  return result.map(row => ({labels: row.metric ?? {}, value: Number(row.value?.[1])}));
}

/** One summary from the three answers; a missing series is a failure, never a zero.
 * @param {string} channel @param {{tick: unknown, rss: unknown, heapSlope: unknown}} answers */
export function summarize(channel, answers) {
  const c = known(channel);
  const ticks = rows(answers.tick).filter(row => Number.isFinite(row.value));
  const [rss] = rows(answers.rss);
  const [heap] = rows(answers.heapSlope);
  if (ticks.length === 0 || rss === undefined || !Number.isFinite(rss.value) || heap === undefined || !Number.isFinite(heap.value)) {
    throw new Error(`${c}: Prometheus holds no tick, RSS or heap series for the last ${WINDOW}`);
  }
  const worst = ticks.reduce((a, b) => (b.value > a.value ? b : a));
  const rssLimit = RSS_CAP_BYTES[c] * RSS_SHARE;
  return {
    channel: c,
    window: WINDOW,
    tickP95MaxMs: round(worst.value * 1000),
    tickP95Worker: String(worst.labels.worker ?? ''),
    workers: ticks.length,
    rssMiB: round(rss.value / 2 ** 20),
    heapSlopeKiBPerMin: round((heap.value * 60) / 1024),
    tickOk: worst.value <= TICK_P95_BUDGET_S,
    rssOk: rss.value <= rssLimit,
  };
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 100) / 100;
}

/** @param {string} command @returns {string} */
function ssh(command) {
  const done = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST, command], {encoding: 'utf8', maxBuffer: 1 << 24});
  if (done.status !== 0) throw new Error(`ssh ${HOST} exited ${done.status ?? done.signal}`);
  return done.stdout;
}

/** @param {string[]} argv @param {(command: string) => string} run */
export function main(argv, run = ssh) {
  const [verb, channel = ''] = argv;
  if (verb === 'probe') {
    const queries = probeQueries(channel);
    /** @param {string} query @returns {unknown} */
    const read = query => JSON.parse(run(promCommand(query)));
    const answers = {tick: read(queries.tick), rss: read(queries.rss), heapSlope: read(queries.heapSlope)};
    return summarize(channel, answers);
  }
  if (verb === 'restart') {
    const command = restartCommand(channel);
    const state = run(command).trim().split('\n').at(-1);
    if (state !== 'active') throw new Error(`staging server is '${state}' after the restart`);
    return {channel, restarted: true, state};
  }
  throw new Error('usage: box-ops.mjs probe <staging|production> | restart staging');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(main(process.argv.slice(2))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
