#!/usr/bin/env node
// meta MINI-DEVEX MD1 (mini-devex-phone, 2026-11-21): the phone runner, the one process that takes iphone13.lock. It works
// the queue (phone-queue.mjs) one job at a time, in plan priority:
//   1. leave the job pending while the phone requires a passcode. Then cool it outside the lock to the job's line
//      (36 °C unless the job says otherwise; at most 30 min), reading only the battery;
//   2. take iphone13.lock (blocking lockf: a lane's old checkout that still holds it is waited on, never broken) and run
//      the job under it (this file's --job mode), killing it past its hold limit (30 min unless the job says otherwise);
//   3. park Safari on about:blank before the lock goes, so the next job's phone starts cool;
//   4. read the run for a void (a non-zero exit, a run with an error or a boot that never reached control, a dead origin)
//      and retry it once after the origin answers again, keeping the voided output beside it (<out>.void1);
//   5. write done/<id>.json and one receipt line in ~/.cache/wildshard/lane-receipts.log.
//
//   node src/scripts/memory/iphone/phone-runner.mjs --install     launchd keeps it (io.wildshard.phone-runner); a submit does this
//   node src/scripts/memory/iphone/phone-runner.mjs --uninstall
//   node src/scripts/memory/iphone/phone-runner.mjs --serve [--idle-exit <s>]   the loop (launchd runs it under runner.lock)
//
// Test seams: WS_PHONE_QUEUE, WS_LOCK_ROOT, WS_PHONE_COOL=off, WS_PHONE_PARK=off, WS_RECEIPTS_LOG, WS_PHONE_ORIGIN_WAIT_S.
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { lockfArgs, lockRoot } from './locks.mjs';
import { atomicWrite, pendingJobs, queueDirs, queueRoot } from './phone-queue.mjs';

const UDID = process.env.WS_PHONE_UDID ?? '00008110-000A35C61E90401E';
const LABEL = 'io.wildshard.phone-runner';

/** @typedef {import('./phone-queue.mjs').PhoneJob} PhoneJob */
/** @typedef {import('./phone-queue.mjs').Attempt} Attempt */
/** @typedef {import('./phone-queue.mjs').PhoneResult} PhoneResult */

const cancun = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Cancun', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
/** @param {string} line */
function receipt(line) {
  const file = process.env.WS_RECEIPTS_LOG ?? join(homedir(), '.cache/wildshard/lane-receipts.log');
  try { mkdirSync(dirname(file), { recursive: true }); appendFileSync(file, `${cancun()} Cancún phone-runner ${line}\n`); } catch { /* a receipt never stops the runner */ }
}

/** True while a passcode is required, false after unlock, or null when CoreDevice can't read it. */
function phonePasscodeRequired() {
  const read = spawnSync('xcrun', ['devicectl', 'device', 'info', 'lockState', '--device', UDID], { encoding: 'utf8', timeout: 5000 });
  if (read.status !== 0) return null;
  const state = /^[ \t]*passcodeRequired:[ \t]*(true|false)[ \t]*$/mu.exec(read.stdout)?.[1];
  return state === undefined ? null : state === 'true';
}

/** Why a finished run is void, and whether a retry can help, or null for a good run.
 * @param {{ code: number | null, timedOut: boolean, log: string, report: unknown }} run */
export function voidReason({ code, timedOut, log, report }) {
  if (/PHONE LOCKED/u.test(log)) return { reason: 'phone locked', retry: false };
  if (timedOut) return { reason: 'over its hold limit', retry: false };
  if (code !== 0) return { reason: `exit ${String(code)}`, retry: true };
  const rows = Array.isArray(report) ? report : [];
  for (const row of rows) {
    const where = `run ${String(row?.run ?? '?')}${row?.cap === undefined ? '' : ` cap ${String(row.cap)}`}`;
    if (typeof row?.error === 'string' && row.error !== '') return { reason: `${where}: ${row.error.slice(0, 160)}`, retry: true };
    if (row?.boot !== undefined && row.boot?.outcome !== 'control') return { reason: `${where}: boot ${String(row.boot?.outcome ?? 'never started')}`, retry: true };
  }
  if (/\b502 Bad Gateway\b|\bERR_CONNECTION_\w+|\bECONNREFUSED\b|\bERR_NAME_NOT_RESOLVED\b/u.test(log.slice(-20_000))) return { reason: 'origin down', retry: true };
  return null;
}

/** The run's report: route-bench's route.json or link-bench's link.json in its output folder. @param {string | null} out */
function readReport(out) {
  for (const name of ['route.json', 'link.json']) {
    if (out !== null && existsSync(join(out, name))) { try { return JSON.parse(readFileSync(join(out, name), 'utf8')); } catch { return null; } }
  }
  return null;
}

/** Wait (at most WS_PHONE_ORIGIN_WAIT_S, 120 s) for the job's origin to answer. @param {string | null} base @param {(line: string) => void} say */
async function originBack(base, say) {
  if (base === null) return true;
  const limit = Date.now() + Number(process.env.WS_PHONE_ORIGIN_WAIT_S ?? 120) * 1000;
  for (let first = true; Date.now() < limit; first = false) {
    try { if ((await fetch(base, { cache: 'no-store', signal: AbortSignal.timeout(5000) })).ok) return true; } catch { /* still down */ }
    if (first) say(`origin ${base} is down; waiting for it before the retry`);
    await delay(2000);
  }
  return false;
}

/** The battery's temperature, °C, or null (no phone, or WS_PHONE_COOL=off). */
async function temperature() {
  if (process.env.WS_PHONE_COOL === 'off') return null;
  const { batteryTemperature, command } = await import('./doctor.mjs');
  return batteryTemperature(command('idevicediagnostics', ['-u', UDID, 'ioregentry', 'AppleSmartBattery']).output)?.celsius ?? null;
}

/** Cool outside the lock to `line` °C, at most 30 min, touching nothing but the battery reading. @param {number | null} line @param {(l: string) => void} say */
async function cool(line, say) {
  let now = await temperature();
  if (line === null || now === null) return now;
  for (const limit = Date.now() + 30 * 60_000; now !== null && now > line && Date.now() < limit; now = await temperature()) {
    say(`cooling outside the lock: ${String(now)} °C against ${String(line)} °C`);
    await delay(30_000);
  }
  return now;
}

/** One attempt: cool, then hold iphone13.lock around --job. @param {PhoneJob} job @param {number} n @param {string} log @returns {Promise<Attempt>} */
async function attempt(job, n, log) {
  const say = (/** @type {string} */ line) => { appendFileSync(log, `phone-runner: ${line}\n`); };
  const reading = await cool(job.coolTo, say);
  const file = join(queueDirs().running, `${job.id}.json`), result = join(queueDirs().running, `${job.id}.attempt-${String(n)}.json`);
  rmSync(result, { force: true });
  say(`attempt ${String(n)}: waiting for iphone13.lock${reading === null ? '' : ` (${String(reading)} °C)`}`);
  const fd = openSync(log, 'a');
  const child = spawn('/usr/bin/lockf', [...lockfArgs('phone'), process.execPath, import.meta.filename, '--job', file, '--attempt', String(n), ...(reading === null ? [] : ['--cooled'])],
    { stdio: ['ignore', fd, fd], env: process.env });
  closeSync(fd);
  await once(child, 'exit');
  /** @type {Attempt} */
  const done = existsSync(result) ? JSON.parse(readFileSync(result, 'utf8'))
    : { n, code: child.exitCode, signal: child.signalCode, holdS: 0, timedOut: false, parked: null, temperature: reading, startedAt: '', endedAt: new Date().toISOString(), void: null, out: job.out };
  done.temperature = reading;
  const text = readFileSync(log, 'utf8');
  const found = voidReason({ code: done.code, timedOut: done.timedOut, log: text, report: readReport(job.out) });
  done.void = found?.reason ?? null;
  return Object.assign(done, { retry: found?.retry ?? false });
}

/** Run one job to its result. @param {PhoneJob} job @returns {Promise<PhoneResult>} */
export async function runJob(job) {
  const dirs = queueDirs(), log = join(dirs.logs, `${job.id}.log`);
  const startedAt = new Date().toISOString();
  /** @type {Attempt[]} */
  const attempts = [];
  for (let n = 1; n <= 2; n++) {
    const one = await attempt(job, n, log);
    attempts.push(one);
    if (one.void === null || !(/** @type {any} */ (one).retry) || n === 2) break;
    appendFileSync(log, `phone-runner: attempt ${String(n)} void (${one.void}); retrying once\n`);
    if (job.out !== null && existsSync(job.out)) { rmSync(`${job.out}.void${String(n)}`, { recursive: true, force: true }); renameSync(job.out, `${job.out}.void${String(n)}`); one.out = `${job.out}.void${String(n)}`; }
    if (!(await originBack(job.base, (line) => { appendFileSync(log, `phone-runner: ${line}\n`); }))) { appendFileSync(log, 'phone-runner: the origin never came back; no retry\n'); break; }
  }
  const last = /** @type {Attempt} */ (attempts.at(-1));
  const status = last.void === 'phone locked' ? 'stopped' : last.void === null ? 'done' : 'void';
  const label = status === 'stopped' ? 'stopped: phone locked (no retry)'
    : attempts.length === 1 ? (last.void === null ? 'clean' : `void: ${last.void} (no retry)`)
      : last.void === null ? `retried once after void: ${String(attempts[0]?.void)}` : `void twice: ${String(attempts[0]?.void)}; ${last.void}`;
  return { id: job.id, lane: job.lane, priority: job.priority, status, code: last.code, label, attempts, submittedAt: new Date(job.submittedAt).toISOString(), startedAt, finishedAt: new Date().toISOString(), log };
}

/** --job: the part under iphone13.lock. Runs the job's command, enforces the hold limit, parks Safari, writes the attempt.
 * @param {string} file @param {number} n @param {boolean} cooled */
async function underLock(file, n, cooled) {
  /** @type {PhoneJob} */
  const job = JSON.parse(readFileSync(file, 'utf8'));
  const startedAt = new Date();
  console.log(`phone-runner: attempt ${String(n)} holds iphone13.lock: ${job.argv.slice(1).join(' ')}`);
  const argv = [...job.argv, ...(cooled && job.cooledFlag !== null ? [job.cooledFlag] : [])];
  const child = spawn(argv[0], argv.slice(1), { cwd: job.cwd, stdio: 'inherit', detached: true,
    env: { ...process.env, ...job.env, WS_PHONE_JOB: job.id, WS_PHONE_ATTEMPT: String(n) } });
  let timedOut = false;
  const limit = setTimeout(() => {
    timedOut = true;
    console.log(`phone-runner: over the ${String(job.maxHoldMin)} min hold limit; stopping the job`);
    try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    setTimeout(() => { try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 10_000).unref();
  }, job.maxHoldMin * 60_000);
  const [code, signal] = await once(child, 'exit');
  clearTimeout(limit);
  let parked = null;
  if (process.env.WS_PHONE_PARK !== 'off') {
    const park = spawnSync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', UDID, '--terminate-existing', '--payload-url', 'about:blank', 'com.apple.mobilesafari'], { encoding: 'utf8', timeout: 60_000 });
    parked = park.status === 0;
    console.log(`phone-runner: Safari ${parked ? 'parked on about:blank' : `not parked: ${(park.stderr || park.stdout).trim().split('\n').at(-1) ?? ''}`}`);
  }
  const endedAt = new Date();
  atomicWrite(join(dirname(file), `${job.id}.attempt-${String(n)}.json`), { n, code, signal, holdS: Math.round((endedAt.getTime() - startedAt.getTime()) / 100) / 10, timedOut, parked,
    temperature: null, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), void: null, out: job.out });
  process.exitCode = code ?? 1;
}

/** Jobs the last runner left running (it died mid-job): back to pending once, or a void result. */
function recover() {
  const dirs = queueDirs();
  for (const name of existsSync(dirs.running) ? readdirSync(dirs.running) : []) {
    if (!name.endsWith('.json') || name.includes('.attempt-')) { if (name.includes('.attempt-')) rmSync(join(dirs.running, name), { force: true }); continue; }
    const job = JSON.parse(readFileSync(join(dirs.running, name), 'utf8'));
    if (job.recovered === true) {
      const result = { id: job.id, lane: job.lane, priority: job.priority, status: 'void', code: null, label: 'void: the runner died twice during it', attempts: [],
        submittedAt: new Date(job.submittedAt).toISOString(), startedAt: '', finishedAt: new Date().toISOString(), log: join(dirs.logs, `${job.id}.log`) };
      atomicWrite(join(dirs.done, `${job.id}.json`), result);
    } else {
      atomicWrite(join(dirs.pending, name), { ...job, recovered: true });
    }
    rmSync(join(dirs.running, name), { force: true });
  }
}

/** The loop. @param {{ idleExitS?: number }} options */
async function serve({ idleExitS }) {
  const dirs = queueDirs();
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  recover();
  console.log(`${new Date().toISOString()} phone-runner ${String(process.pid)} serving ${queueRoot()}`);
  let idleSince = Date.now();
  let passcodeRequired = false;
  for (;;) {
    const [job] = pendingJobs();
    if (job === undefined) {
      if (idleExitS !== undefined && Date.now() - idleSince > idleExitS * 1000) return;
      await delay(1000);
      continue;
    }
    const lockState = phonePasscodeRequired();
    if (lockState === true && !passcodeRequired) receipt('PHONE LOCKED: unlock the iPhone 13');
    // If the locked device temporarily disappears, require an explicit unlock before taking a job again.
    passcodeRequired = lockState ?? passcodeRequired;
    if (passcodeRequired) {
      await delay(1000);
      continue;
    }
    const from = join(dirs.pending, `${job.id}.json`), to = join(dirs.running, `${job.id}.json`);
    try { renameSync(from, to); } catch { continue; } // cancelled meanwhile
    const result = await runJob(job);
    atomicWrite(join(dirs.done, `${job.id}.json`), result);
    for (const name of readdirSync(dirs.running).filter((n) => n.startsWith(`${job.id}.`))) rmSync(join(dirs.running, name), { force: true });
    const waited = Math.round((Date.parse(result.startedAt) - job.submittedAt) / 1000);
    receipt(`${job.id} lane ${job.lane} ${job.priority} ${result.status} (${result.label}); waited ${String(waited)} s, held ${result.attempts.map((a) => `${String(a.holdS)} s`).join(' + ')}${result.attempts[0]?.temperature === null || result.attempts[0]?.temperature === undefined ? '' : `, ${String(result.attempts[0].temperature)} °C`}; log ${result.log}`);
    console.log(`${new Date().toISOString()} ${job.id} ${result.status}: ${result.label}`);
    idleSince = Date.now();
  }
}

const domain = () => `gui/${String(process.getuid?.() ?? 501)}`;

/** launchd keeps the runner, holding runner.lock so a second one exits at once. */
function install() {
  const root = queueRoot();
  mkdirSync(root, { recursive: true });
  const plist = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
  const path = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  const args = ['/usr/bin/lockf', '-t', '0', join(root, 'runner.lock'), process.execPath, import.meta.filename, '--serve'];
  const xml = (/** @type {string} */ s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${xml(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string><key>HOME</key><string>${xml(homedir())}</string></dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(root, 'runner.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(root, 'runner.log'))}</string>
</dict></plist>
`);
  spawnSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' });
  const boot = spawnSync('launchctl', ['bootstrap', domain(), plist], { encoding: 'utf8' });
  if (boot.status !== 0) throw new Error(`launchctl bootstrap ${plist}: ${boot.stderr.trim()}`);
  console.log(`phone-runner: launchd keeps ${LABEL} (${plist}); log ${join(root, 'runner.log')}`);
}

async function main() {
  const { values } = parseArgs({ options: {
    serve: { type: 'boolean' }, install: { type: 'boolean' }, uninstall: { type: 'boolean' }, 'idle-exit': { type: 'string' },
    job: { type: 'string' }, attempt: { type: 'string', default: '1' }, cooled: { type: 'boolean' },
  } });
  if (values.job !== undefined) { await underLock(values.job, Number(values.attempt), values.cooled === true); return; }
  if (values.install) { install(); return; }
  if (values.uninstall) {
    spawnSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' });
    rmSync(join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`), { force: true });
    console.log(`phone-runner: ${LABEL} removed`);
    return;
  }
  if (values.serve) { await serve({ idleExitS: values['idle-exit'] === undefined ? undefined : Number(values['idle-exit']) }); return; }
  console.log(`usage: phone-runner.mjs --install | --uninstall | --serve [--idle-exit <s>]   (queue ${queueRoot()}, lock ${lockRoot()})`);
}

if (process.argv[1] === import.meta.filename) await main();
