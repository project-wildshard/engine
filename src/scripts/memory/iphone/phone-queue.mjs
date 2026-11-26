#!/usr/bin/env node
// meta MINI-DEVEX MD1 (mini-devex-phone, 2026-11-21): the phone queue. One long-running runner (phone-runner.mjs, kept
// by launchd) owns the iPhone 13; lanes never take iphone13.lock themselves. A lane submits a job to a queue directory and
// waits on its result file; the runner cools the phone outside the lock, takes the lock, runs the job, parks Safari,
// writes the result and a receipt, and retries a voided run once with the reason.
//
// route-bench, link-bench, bench.mjs and the release suite submit for you (locks.mjs underPhoneLocks): their commands are
// unchanged and stream the job's log. Any other phone script goes through the CLI:
//
//   node src/scripts/memory/iphone/phone-queue.mjs submit [--priority driftwood-fps|frame-walk|zone-boot|other]
//     [--cool-to 36] [--cooled-flag <flag>] [--base <origin>] [--out <dir>] [--max-hold <min>] -- <script> [args...]
//   node src/scripts/memory/iphone/phone-queue.mjs status
//
// Order (Jake 2026-11-21): plan priority, DRIFTWOOD-FPS first, then J484's order: frame-rate walks, then zone boots;
// first come first served within a priority. A route-bench on Driftwood Isle is DRIFTWOOD-FPS, any other route-bench or
// a bench walk is a frame-rate walk, link-bench and a bench boot are zone boots; WS_PHONE_PRIORITY overrides.
//
// The queue lives beside the locks (locks.mjs lockRoot(), the canonical engine tmp/): phone-queue/{pending,running,done,
// logs}. WS_PHONE_QUEUE moves it (tests); WS_PHONE_RUNNER_START=none submits without starting the runner (tests).
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { lockRoot } from './locks.mjs';

export const PRIORITIES = /** @type {const} */ (['driftwood-fps', 'frame-walk', 'zone-boot', 'other']);
/** @typedef {typeof PRIORITIES[number]} Priority */

/** @typedef {{ id: string, lane: string, priority: Priority, rank: number, submittedAt: number, argv: string[], cwd: string,
 *   env: Record<string, string>, coolTo: number | null, cooledFlag: string | null, base: string | null, out: string | null,
 *   maxHoldMin: number, submitter: number }} PhoneJob */
/** @typedef {{ n: number, code: number | null, signal: string | null, holdS: number, timedOut: boolean, parked: boolean | null,
 *   temperature: number | null, startedAt: string, endedAt: string, void: string | null, out: string | null }} Attempt */
/** @typedef {{ id: string, lane: string, priority: Priority, status: 'done' | 'void' | 'stopped', code: number | null, label: string,
 *   attempts: Attempt[], submittedAt: string, startedAt: string, finishedAt: string, log: string }} PhoneResult */

export const queueRoot = () => process.env.WS_PHONE_QUEUE ?? join(lockRoot(), 'phone-queue');
/** @param {string} [root] */
export const queueDirs = (root = queueRoot()) => ({ pending: join(root, 'pending'), running: join(root, 'running'), done: join(root, 'done'), logs: join(root, 'logs') });

/** Which plan priority a phone script's run is. @param {string} script @param {string[]} args @param {NodeJS.ProcessEnv} [env] @returns {Priority} */
export function priorityFor(script, args, env = process.env) {
  const asked = /** @type {Priority | undefined} */ (env.WS_PHONE_PRIORITY);
  if (asked !== undefined && PRIORITIES.includes(asked)) return asked;
  const flag = (/** @type {string} */ name) => { const at = args.indexOf(name); return at === -1 ? undefined : args[at + 1]; };
  const name = basename(script);
  if (name === 'route-bench.mjs') return (flag('--zone') ?? 'driftwood-isle') === 'driftwood-isle' ? 'driftwood-fps' : 'frame-walk';
  if (name === 'link-bench.mjs') return 'zone-boot';
  if (name === 'bench.mjs') return args[0] === '--suite' || ['walk', 'soak'].includes(flag('--mode') ?? 'boot') ? 'frame-walk' : 'zone-boot';
  return 'other';
}

/** Pending jobs in run order: priority, then first come first served. @param {PhoneJob[]} jobs */
export const runOrder = (jobs) => [...jobs].sort((a, b) => a.rank - b.rank || a.submittedAt - b.submittedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** @param {string} file */
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** Write a file whole: a reader never sees half of it. @param {string} file @param {unknown} value */
export function atomicWrite(file, value) {
  writeFileSync(`${file}.${String(process.pid)}.tmp`, JSON.stringify(value, null, 2));
  renameSync(`${file}.${String(process.pid)}.tmp`, file);
}

/** @param {string} [root] @returns {PhoneJob[]} */
export function pendingJobs(root = queueRoot()) {
  const { pending } = queueDirs(root);
  if (!existsSync(pending)) return [];
  return runOrder(readdirSync(pending).filter((name) => name.endsWith('.json')).map((name) => readJson(join(pending, name))).filter((job) => job !== null));
}

let sequence = 0;
/** Queue a phone job; resolves to the job written.
 * @param {{ argv: string[], cwd?: string, priority?: Priority, coolTo?: number | null, cooledFlag?: string | null, base?: string | null,
 *   out?: string | null, maxHoldMin?: number, lane?: string, env?: Record<string, string> }} spec @param {string} [root] */
export function submit(spec, root = queueRoot()) {
  const dirs = queueDirs(root);
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  const script = spec.argv[1] ?? spec.argv[0] ?? '';
  const priority = spec.priority ?? priorityFor(script, spec.argv.slice(2));
  const submittedAt = Date.now();
  const lane = spec.lane ?? process.env.WS_LANE_NAME ?? 'unnamed';
  const id = `${String(submittedAt)}-${lane.replaceAll(/[^\w.-]/gu, '_')}-${String(process.pid)}-${String(sequence++)}`;
  // the lane's own WS_* settings and PATH travel with the job; the runner's environment supplies the rest
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => (key.startsWith('WS_') || key === 'PATH') && value !== undefined && key !== 'WS_PHONE_QUEUE')), ...spec.env };
  /** @type {PhoneJob} */
  const job = { id, lane, priority, rank: PRIORITIES.indexOf(priority), submittedAt, argv: spec.argv, cwd: resolve(spec.cwd ?? process.cwd()),
    env: /** @type {Record<string, string>} */ (env), coolTo: spec.coolTo ?? null, cooledFlag: spec.cooledFlag ?? null, base: spec.base ?? null,
    out: spec.out === undefined || spec.out === null ? null : resolve(spec.out), maxHoldMin: spec.maxHoldMin ?? 30, submitter: process.pid };
  atomicWrite(join(dirs.pending, `${id}.json`), job);
  return job;
}

/** The runner is up: it holds runner.lock for its lifetime. @param {string} [root] */
export const runnerAlive = (root = queueRoot()) => spawnSync('/usr/bin/lockf', ['-t', '0', join(root, 'runner.lock'), '/usr/bin/true']).status === 75;

/** Start the runner under launchd when it is not up (phone-runner.mjs --install). @param {string} [root] */
export function ensureRunner(root = queueRoot()) {
  if (process.env.WS_PHONE_RUNNER_START === 'none' || runnerAlive(root)) return;
  const canonical = join(lockRoot(), '..', 'src/scripts/memory/iphone/phone-runner.mjs');
  const runner = existsSync(canonical) ? canonical : join(import.meta.dirname, 'phone-runner.mjs');
  const done = spawnSync(process.execPath, [runner, '--install'], { encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`phone queue: the runner did not start: ${done.stderr || done.stdout}`);
}

/** Wait for a job's result, printing its log as it grows. @param {string} id @param {{ root?: string, follow?: boolean, pollMs?: number }} [options]
 * @returns {Promise<PhoneResult>} */
export async function waitFor(id, { root = queueRoot(), follow = true, pollMs = 500 } = {}) {
  const dirs = queueDirs(root), log = join(dirs.logs, `${id}.log`), result = join(dirs.done, `${id}.json`);
  let offset = 0;
  const drain = () => {
    if (!follow || !existsSync(log)) return;
    const size = statSync(log).size;
    if (size <= offset) return;
    const fd = openSync(log, 'r'), buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    closeSync(fd);
    offset = size;
    process.stdout.write(buffer);
  };
  for (;;) {
    drain();
    const done = readJson(result);
    if (done !== null) { drain(); return done; }
    await delay(pollMs);
  }
}

/** Submit and wait: what route-bench, link-bench and bench.mjs do instead of taking iphone13.lock. Resolves to the exit code.
 * @param {Parameters<typeof submit>[0]} spec */
export async function submitAndWait(spec) {
  const root = queueRoot();
  const job = submit(spec, root);
  ensureRunner(root);
  const ahead = pendingJobs(root).findIndex((j) => j.id === job.id);
  const running = existsSync(queueDirs(root).running) ? readdirSync(queueDirs(root).running).filter((n) => /^[^.]+.*\.json$/u.test(n) && !n.includes('.attempt-')).length : 0;
  console.log(`phone queue: job ${job.id} (${job.priority}), ${String(Math.max(0, ahead))} ahead${running > 0 ? ' and one running' : ''}; the runner takes iphone13.lock (log ${join(queueDirs(root).logs, `${job.id}.log`)})`);
  const cancel = () => {
    const file = join(queueDirs(root).pending, `${job.id}.json`);
    if (existsSync(file)) { rmSync(file, { force: true }); console.log(`phone queue: job ${job.id} cancelled before it ran`); }
    else console.log(`phone queue: job ${job.id} is running; the runner finishes and parks the phone (result ${join(queueDirs(root).done, `${job.id}.json`)})`);
    process.exit(130);
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const result = await waitFor(job.id, { root });
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
  console.log(`phone queue: job ${job.id} ${result.status}: ${result.label}`);
  return result.code ?? 1;
}

async function main() {
  const [verb, ...rest] = process.argv.slice(2);
  const root = queueRoot();
  if (verb === 'status') {
    const dirs = queueDirs(root);
    console.log(`runner ${runnerAlive(root) ? 'up' : 'down'} (${root})`);
    for (const name of existsSync(dirs.running) ? readdirSync(dirs.running).filter((n) => n.endsWith('.json') && !n.includes('.attempt-')) : []) {
      const job = readJson(join(dirs.running, name));
      if (job !== null) console.log(`running  ${job.id} ${job.priority} ${String(job.argv[1] ?? '')}`);
    }
    for (const job of pendingJobs(root)) console.log(`pending  ${job.id} ${job.priority} ${job.argv[1] ?? ''}`);
    const done = existsSync(dirs.done) ? readdirSync(dirs.done).filter((n) => n.endsWith('.json')).sort().slice(-5) : [];
    for (const name of done) { const r = readJson(join(dirs.done, name)); if (r !== null) console.log(`done     ${r.id} ${r.status} ${r.label}`); }
    return;
  }
  if (verb !== 'submit') throw new Error('usage: phone-queue.mjs submit [options] -- <script> [args...] | status');
  const split = rest.indexOf('--');
  if (split === -1 || split === rest.length - 1) throw new Error('phone-queue submit: name the script after --');
  const { values } = parseArgs({ args: rest.slice(0, split), options: {
    priority: { type: 'string' }, 'cool-to': { type: 'string', default: '36' }, 'cooled-flag': { type: 'string' }, base: { type: 'string' },
    out: { type: 'string' }, 'max-hold': { type: 'string', default: '30' },
  } });
  const [script, ...args] = rest.slice(split + 1);
  const priority = /** @type {Priority | undefined} */ (values.priority);
  if (priority !== undefined && !PRIORITIES.includes(priority)) throw new Error(`--priority is one of ${PRIORITIES.join(', ')}`);
  const interpreter = extname(script) === '.py' ? 'python3' : process.execPath;
  process.exitCode = await submitAndWait({ argv: [interpreter, resolve(script), ...args], priority, coolTo: Number(values['cool-to']),
    cooledFlag: values['cooled-flag'] ?? null, base: values.base ?? null, out: values.out ?? null, maxHoldMin: Number(values['max-hold']) });
}

if (process.argv[1] === import.meta.filename) await main();
