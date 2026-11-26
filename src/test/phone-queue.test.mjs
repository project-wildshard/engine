// meta MINI-DEVEX MD1 (mini-devex-phone, 2026-11-21): the phone queue's done-when, with a fake lock root and fake jobs.
// Two lanes submit three jobs each at once; all six run one at a time in plan priority, first come first served within a
// priority, each under iphone13.lock held by the runner, never by a lane. A forced void (the origin killed under the job)
// is retried once, after the origin answers again, and labelled.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, expect, test } from 'vitest';

// The runner holds iphone13.lock with BSD lockf(1), which only macOS has (the Mac mini, the one host with the phone);
// hosted Linux CI runs the priority and void tests only.
const darwin = process.platform === 'darwin' && existsSync('/usr/bin/lockf');
import { priorityFor, runOrder } from '../scripts/memory/iphone/phone-queue.mjs';
import { voidReason } from '../scripts/memory/iphone/phone-runner.mjs';

const engine = join(import.meta.dirname, '../..');
const queueModule = join(engine, 'src/scripts/memory/iphone/phone-queue.mjs');
const runnerScript = join(engine, 'src/scripts/memory/iphone/phone-runner.mjs');
const dir = mkdtempSync(join(tmpdir(), 'phone-queue-'));
/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
afterAll(() => { for (const child of children) child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); });

/** @param {string} name */
const fresh = (name) => {
  const root = join(dir, name);
  const bin = join(root, 'bin'), lockState = join(root, 'lock-state'), reads = join(root, 'lock-reads');
  mkdirSync(bin, { recursive: true });
  writeFileSync(lockState, 'false');
  writeFileSync(join(bin, 'xcrun'), `#!/bin/sh
[ "$*" = 'devicectl device info lockState --device test-phone' ] || exit 1
printf 'read\\n' >> "$WS_TEST_LOCK_READS"
state=$(cat "$WS_TEST_LOCK_STATE")
[ "$state" != unavailable ] || exit 1
printf 'Device lock state:\\n  passcodeRequired: %s\\n' "$state"
`, { mode: 0o755 });
  return { root, env: { ...process.env, WS_LOCK_ROOT: root, WS_PHONE_QUEUE: join(root, 'queue'), WS_PHONE_COOL: 'off', WS_PHONE_PARK: 'off',
    WS_PHONE_RUNNER_START: 'none', WS_RECEIPTS_LOG: join(root, 'receipts.log'), WS_PHONE_ORIGIN_WAIT_S: '30',
    WS_PHONE_UDID: 'test-phone', WS_TEST_LOCK_STATE: lockState, WS_TEST_LOCK_READS: reads, PATH: `${bin}:${process.env.PATH ?? ''}` } };
};
/** @param {Record<string, string | undefined>} env @param {string[]} [args] */
const runner = (env, args = ['--serve', '--idle-exit', '3']) => { const child = spawn(process.execPath, [runnerScript, ...args], { env, stdio: 'ignore' }); children.push(child); return child; };
/** @param {import('node:child_process').ChildProcess} child */
const exited = (child) => new Promise((resolve) => { if (child.exitCode !== null) resolve(child.exitCode); else child.once('exit', resolve); });
/** @param {() => boolean} ready @param {number} [ms] */
async function until(ready, ms = 20_000) { for (const limit = Date.now() + ms; !ready(); await delay(100)) if (Date.now() > limit) throw new Error('timed out'); }

test('priority follows the plans: DRIFTWOOD-FPS, then frame-rate walks, then zone boots; first come first served within one', () => {
  expect(priorityFor('/e/scripts/memory/iphone/route-bench.mjs', ['--route', 'driftwood-fps'], {})).toBe('driftwood-fps');
  expect(priorityFor('/e/scripts/memory/iphone/route-bench.mjs', ['--zone', 'nine-dragon-stack'], {})).toBe('frame-walk');
  expect(priorityFor('/e/scripts/memory/iphone/bench.mjs', ['--mode', 'walk'], {})).toBe('frame-walk');
  expect(priorityFor('/e/scripts/memory/iphone/bench.mjs', ['--mode', 'boot'], {})).toBe('zone-boot');
  expect(priorityFor('/e/scripts/memory/iphone/link-bench.mjs', [], {})).toBe('zone-boot');
  expect(priorityFor('/e/tmp/x/phone-once.mjs', [], {})).toBe('other');
  expect(priorityFor('/e/tmp/x/phone-once.mjs', [], { WS_PHONE_PRIORITY: 'driftwood-fps' })).toBe('driftwood-fps');
  const job = (/** @type {string} */ id, /** @type {number} */ rank, /** @type {number} */ submittedAt) => /** @type {any} */ ({ id, rank, submittedAt });
  expect(runOrder([job('c', 2, 1), job('b', 0, 3), job('a', 0, 2), job('d', 1, 0)]).map((j) => j.id)).toEqual(['a', 'b', 'd', 'c']);
});

test('a void is a non-zero exit, a run with an error or no control, or a dead origin; a locked phone stops without a retry', () => {
  expect(voidReason({ code: 0, timedOut: false, log: '', report: [{ run: 1, cap: 60, boot: { outcome: 'control' } }] })).toBeNull();
  expect(voidReason({ code: 0, timedOut: false, log: '', report: [{ run: 1, cap: 60, error: 'fetch failed', boot: null }] })).toEqual({ reason: 'run 1 cap 60: fetch failed', retry: true });
  expect(voidReason({ code: 0, timedOut: false, log: '', report: [{ run: 2, cap: 30, boot: { outcome: 'timeout' } }] })).toEqual({ reason: 'run 2 cap 30: boot timeout', retry: true });
  expect(voidReason({ code: 1, timedOut: false, log: '', report: null })?.reason).toBe('exit 1');
  expect(voidReason({ code: 0, timedOut: false, log: 'Error: 502 Bad Gateway', report: null })?.reason).toBe('origin down');
  expect(voidReason({ code: 1, timedOut: false, log: 'PHONE LOCKED at run 1', report: null })).toEqual({ reason: 'phone locked', retry: false });
});

test.skipIf(!darwin)('keeps queued jobs pending until the passcode lock clears, with one receipt per lock', async () => {
  const { root, env } = fresh('passcode');
  const { WS_TEST_LOCK_STATE: state, WS_TEST_LOCK_READS: reads, WS_RECEIPTS_LOG: receipts } = env;
  const notice = 'PHONE LOCKED: unlock the iPhone 13';
  const submit = () => {
    const job = spawnSync(process.execPath, ['--input-type=module', '-e', `const q = await import(${JSON.stringify(queueModule)});
console.log(q.submit({ argv: ['/usr/bin/true'], coolTo: null }).id);`], { env, encoding: 'utf8' });
    expect(job.status).toBe(0);
    return job.stdout.trim();
  };
  const countReads = () => existsSync(reads) ? readFileSync(reads, 'utf8').trim().split('\n').length : 0;
  const countNotices = () => existsSync(receipts) ? readFileSync(receipts, 'utf8').split(notice).length - 1 : 0;
  const pending = (/** @type {string} */ id) => join(root, 'queue/pending', `${id}.json`);
  const done = (/** @type {string} */ id) => join(root, 'queue/done', `${id}.json`);
  writeFileSync(state, 'true');
  const first = submit();
  const serving = runner(env, ['--serve']);
  try {
    await until(() => countNotices() === 1 || existsSync(done(first)), 4000);
    expect(existsSync(pending(first))).toBe(true);
    expect(readdirSync(join(root, 'queue/running'))).toEqual([]);
    await until(() => countReads() >= 2);
    writeFileSync(state, 'unavailable');
    const beforeFailure = countReads();
    await until(() => countReads() > beforeFailure);
    expect(existsSync(pending(first))).toBe(true);
    expect(countNotices()).toBe(1);

    writeFileSync(state, 'false');
    await until(() => existsSync(done(first)));
    expect(JSON.parse(readFileSync(done(first), 'utf8')).attempts.map((/** @type {{ void: string | null }} */ a) => a.void)).toEqual([null]);

    writeFileSync(state, 'true');
    const second = submit();
    await until(() => countNotices() === 2 || existsSync(done(second)));
    expect(existsSync(pending(second))).toBe(true);
    expect(countNotices()).toBe(2);
    writeFileSync(state, 'false');
    await until(() => existsSync(done(second)));
    expect(JSON.parse(readFileSync(done(second), 'utf8')).label).toBe('clean');
  } finally {
    serving.kill();
    await exited(serving);
  }
}, 30_000);

test.skipIf(!darwin)('two lanes submit three jobs each at once; all six finish in order, one at a time, under the runner\'s lock', async () => {
  const { root, env } = fresh('order');
  const lock = join(root, 'iphone13.lock'), trace = join(root, 'trace.log');
  writeFileSync(join(dir, 'job.mjs'), `
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [name, lock, trace] = process.argv.slice(2);
const held = spawnSync('/usr/bin/lockf', ['-t', '0', lock, '/usr/bin/true']).status === 75;
const chain = []; for (let pid = process.pid; pid > 1 && chain.length < 12;) { chain.push(pid); pid = Number(spawnSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim()) || 1; }
appendFileSync(trace, JSON.stringify({ name, job: process.env.WS_PHONE_JOB, held, chain, start: Date.now() }) + '\\n');
await new Promise((resolve) => setTimeout(resolve, 150));
appendFileSync(trace, JSON.stringify({ name, end: Date.now() }) + '\\n');
`);
  const lane = (/** @type {string} */ name, /** @type {[string, string][]} */ jobs) => {
    const code = `const q = await import(${JSON.stringify(queueModule)});
const codes = await Promise.all(${JSON.stringify(jobs)}.map(([job, priority]) => q.submitAndWait({ argv: [process.execPath, ${JSON.stringify(join(dir, 'job.mjs'))}, job, ${JSON.stringify(lock)}, ${JSON.stringify(trace)}], priority, coolTo: null })));
process.exit(codes.every((c) => c === 0) ? 0 : 1);`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...env, WS_LANE_NAME: name }, stdio: 'ignore' });
    children.push(child);
    return child;
  };
  const laneA = lane('lane-a', [['a-boot', 'zone-boot'], ['a-fps', 'driftwood-fps'], ['a-walk', 'frame-walk']]);
  const laneB = lane('lane-b', [['b-walk', 'frame-walk'], ['b-other', 'other'], ['b-fps', 'driftwood-fps']]);
  const pending = join(root, 'queue/pending');
  await until(() => existsSync(pending) && readdirSync(pending).filter((n) => n.endsWith('.json')).length === 6);
  const queued = runOrder(readdirSync(pending).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(pending, n), 'utf8'))));
  const expected = queued.map((job) => job.argv[2]);
  expect(expected.slice(0, 2).sort()).toEqual(['a-fps', 'b-fps']);
  expect(expected.slice(2, 4).sort()).toEqual(['a-walk', 'b-walk']);
  expect(expected.slice(4)).toEqual(['a-boot', 'b-other']);

  const serving = runner(env);
  expect(await exited(laneA)).toBe(0);
  expect(await exited(laneB)).toBe(0);
  await exited(serving);
  const lines = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const starts = lines.filter((line) => line.start !== undefined);
  expect(starts.map((line) => line.name)).toEqual(expected);
  // one at a time: each job ends before the next starts
  for (let i = 1; i < lines.length; i += 2) expect(lines[i].name).toBe(lines[i - 1].name);
  // each ran under iphone13.lock, as a runner job, with neither lane in its ancestry
  for (const line of starts) {
    expect(line.held).toBe(true);
    expect(line.job).toMatch(/^\d+-lane-[ab]-/u);
    expect(line.chain).not.toContain(laneA.pid);
    expect(line.chain).not.toContain(laneB.pid);
    expect(line.chain).toContain(serving.pid);
  }
  const results = readdirSync(join(root, 'queue/done')).map((n) => JSON.parse(readFileSync(join(root, 'queue/done', n), 'utf8')));
  expect(results.map((r) => r.label)).toEqual(Array(6).fill('clean'));
  expect(readFileSync(join(root, 'receipts.log'), 'utf8').trim().split('\n')).toHaveLength(6);
}, 60_000);

test.skipIf(!darwin)('a forced void (the origin killed) is retried once after the origin is back, and labelled', async () => {
  const { root, env } = fresh('void');
  writeFileSync(join(dir, 'origin-job.mjs'), `
import { mkdirSync, writeFileSync } from 'node:fs';
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let row;
try { const res = await fetch(base); row = res.ok ? { run: 1, cap: 60, boot: { outcome: 'control' } } : { run: 1, cap: 60, error: 'HTTP ' + res.status, boot: null }; }
catch (error) { row = { run: 1, cap: 60, error: 'fetch failed', boot: null }; }
console.log('run 1 cap 60: ' + (row.error ?? 'control'));
writeFileSync(out + '/route.json', JSON.stringify([row]));
`);
  const origin = createServer((request, response) => { response.end('ok'); });
  await new Promise((resolve) => { origin.listen(0, '127.0.0.1', () => { resolve(undefined); }); });
  const address = origin.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0, base = `http://127.0.0.1:${String(port)}/`;
  // the origin dies before the job's boot (a killed serve-local)
  await new Promise((resolve) => { origin.close(() => { resolve(undefined); }); });
  const out = join(root, 'route-out');
  const submitted = spawnSync(process.execPath, ['--input-type=module', '-e', `const q = await import(${JSON.stringify(queueModule)});
const job = q.submit({ argv: [process.execPath, ${JSON.stringify(join(dir, 'origin-job.mjs'))}, ${JSON.stringify(base)}, ${JSON.stringify(out)}], base: ${JSON.stringify(base)}, out: ${JSON.stringify(out)}, coolTo: null });
console.log(job.id);`], { env, encoding: 'utf8' });
  const id = submitted.stdout.trim();
  expect(id).not.toBe('');
  const serving = runner(env);
  const log = join(root, 'queue/logs', `${id}.log`);
  await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('waiting for it before the retry'));
  // serve-local comes back on the same port (MD3's kept world)
  const back = createServer((request, response) => { response.end('ok'); });
  await new Promise((resolve) => { back.listen(port, '127.0.0.1', () => { resolve(undefined); }); });
  await exited(serving);
  back.close();
  const result = JSON.parse(readFileSync(join(root, 'queue/done', `${id}.json`), 'utf8'));
  expect(result.status).toBe('done');
  expect(result.label).toBe('retried once after void: run 1 cap 60: fetch failed');
  expect(result.attempts.map((/** @type {{ void: string | null }} */ a) => a.void)).toEqual(['run 1 cap 60: fetch failed', null]);
  expect(JSON.parse(readFileSync(join(out, 'route.json'), 'utf8'))[0].boot.outcome).toBe('control');
  expect(JSON.parse(readFileSync(`${out}.void1/route.json`, 'utf8'))[0].error).toBe('fetch failed');
  expect(readFileSync(join(root, 'receipts.log'), 'utf8')).toMatch(/phone-runner \S+ lane \S+ other done \(retried once after void: run 1 cap 60: fetch failed\)/u);
}, 60_000);
