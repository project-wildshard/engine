#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW12 / DW11 (mini-dw12e, 2026-11-22): a zone's cold boot, then its warm return in the same tab, on
// the iPhone 13, with the kernel's word on whether WebContent was jetsammed. The warm return is IP9's: the page leaves for
// /robots.txt, waits 300 ms and opens /slug/<zone> again (`hop`); `direct` opens /slug/<zone> from the game page itself (the
// game's document to the game's document: one opener policy, so WebKit keeps the process). Each round starts a fresh Safari.
//
//   node scripts/memory/iphone/phone-queue.mjs submit --priority driftwood-fps -- scripts/memory/iphone/warm-return.mjs \
//     --base https://staging.wildshard.io/ [--zone driftwood-isle] [--arms hop,hop,hop] [--hold 40] [--out <dir>]
//
// Per round it writes <out>/round-<n>/: the filtered device log (WebKit, RunningBoard, jetsam lines), the WebContent pids at
// each stage (devicectl), and every JetsamEvent report the phone wrote in the round's window. RunningBoard's "visiblity is
// yes" lines name the WebContent pid that shows the page, so `visible` is the pid at cold control and at warm control. A
// round passes when the warm boot reaches control, its page still answers `--hold` seconds later, and no WebContent was
// killed. Runs only through the MD1 phone queue (WS_PHONE_JOB).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { writeSaveFixture } from '../../debug-settings.mjs';
import { parseJetsam } from '../iphone-footprint.mjs';
import { doctor } from './doctor.mjs';
import { startInspector } from './inspector.mjs';
import { findButton, phoneSlots, watchPageErrors, waitForControl } from './safari.mjs';

const UDID = '00008110-000A35C61E90401E';
const WATCHED = /WebContent|jetsam|memorystatus/iu;

/** RunningBoard's visible WebContent pid at each moment: [local clock "HH:MM:SS.mmm", pid] in log order.
 * @param {string[]} lines @returns {[string, number][]} */
export function visibleTimeline(lines) {
  /** @type {[string, number][]} */ const out = [];
  for (const line of lines) {
    const match = /^\w+ +\d+ (?<at>\d\d:\d\d:\d\d\.\d{3})\d* runningboardd.*WebContent.*:(?<pid>\d+)\] visiblity is yes/u.exec(line);
    if (match?.groups?.['at'] !== undefined && match.groups['pid'] !== undefined) out.push([match.groups['at'], Number(match.groups['pid'])]);
  }
  return out;
}

/** The visible pid at a host time, from a timeline on the phone's local clock (the Mac's zone).
 * @param {[string, number][]} timeline @param {Date} when @returns {number | null} */
export function visibleAt(timeline, when) {
  const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}:${String(when.getSeconds()).padStart(2, '0')}.${String(when.getMilliseconds()).padStart(3, '0')}`;
  let pid = null;
  for (const [at, which] of timeline) if (at <= clock) pid = which;
  return pid;
}

/** @param {string} file @returns {number[] | { error: string }} */
function webContentPids(file) {
  spawnSync('xcrun', ['devicectl', 'device', 'info', 'processes', '--device', UDID, '--timeout', '15', '--json-output', file], { stdio: 'ignore', timeout: 20_000 });
  try {
    /** @type {number[]} */ const found = [];
    /** @param {unknown} value */
    const walk = value => {
      if (Array.isArray(value)) { value.forEach(walk); return; }
      if (value === null || typeof value !== 'object') return;
      const row = /** @type {Record<string, unknown>} */ (value);
      if (/WebContent/u.test(String(row['executable'] ?? ''))) found.push(Number(row['processIdentifier']));
      else Object.values(row).forEach(walk);
    };
    walk(JSON.parse(readFileSync(file, 'utf8')));
    return found.sort((a, b) => a - b);
  } catch (error) { return { error: String(error) }; }
}

/** The device log, filtered, from now until stop(). @param {string} dir */
function deviceLog(dir) {
  const file = createWriteStream(join(dir, 'device-log.txt'));
  /** @type {string[]} */ const lines = [];
  const live = spawn('idevicesyslog', ['-u', UDID], { stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = '';
  live.stdout.on('data', (/** @type {Buffer} */ chunk) => {
    const parts = (pending + String(chunk)).split('\n');
    pending = parts.pop() ?? '';
    for (const line of parts) if (WATCHED.test(line) && lines.length < 40_000) { lines.push(line); file.write(`${line}\n`); }
  });
  return {
    lines,
    stop: async () => {
      if (live.exitCode === null && live.signalCode === null) {
        const closed = new Promise(done => { live.once('close', done); });
        live.kill('SIGINT');
        await Promise.race([closed, pause(2000)]);
        live.kill('SIGKILL');
      }
      file.end();
    },
  };
}

/** Every JetsamEvent the phone wrote between `since` and `until` (±2 s): its WebKit rows and what it killed.
 * @param {string} dir @param {string} since @param {string} until */
function jetsamReports(dir, since, until) {
  const raw = join(dir, 'pull-JetsamEvent');
  mkdirSync(raw, { recursive: true });
  spawnSync('idevicecrashreport', ['-k', '-f', 'JetsamEvent', '-u', UDID, raw], { stdio: 'ignore', timeout: 30_000 });
  const reports = [];
  for (const name of readdirSync(raw, { recursive: true }).map(String)) {
    const path = join(raw, name);
    if (!name.endsWith('.ips') || !statSync(path).isFile()) continue;
    try {
      const report = parseJetsam(readFileSync(path, 'utf8')), when = Date.parse(String(report.date));
      if (!Number.isFinite(when) || when < Date.parse(since) - 2000 || when > Date.parse(until) + 2000) continue;
      reports.push({ file: name, date: report.date, killed: report.killed, webkit: report.rows.filter(row => WATCHED.test(row.name)) });
    } catch (error) { reports.push({ file: name, error: String(error) }); }
  }
  // the USB copy holds other apps' reports too: only the round's projection is kept
  rmSync(raw, { recursive: true, force: true });
  return reports;
}

/** A call sent to a page WebKit is swapping away never answers: give up after 8 s and ask again.
 * @template T @param {() => Promise<T>} call @param {number} [tries] @returns {Promise<T>} */
async function settled(call, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    try { return await Promise.race([call(), pause(8000).then(() => { throw new Error('no answer in 8 s'); })]); }
    catch (error) {
      if (attempt >= tries || !/timed out|no answer|went away|stale/u.test(String(error))) throw error;
      await pause(500);
    }
  }
}

/** @typedef {import('./inspector.d.mts').InspectedSafari} Page */
/** @typedef {{ outcome?: string, clickToControlMs?: number | null, error?: string | null, controlAt?: string, timeOrigin?: number,
 *   hold?: { seconds: number, answered: number, lost: { at: string, why: string } | null } }} Boot */

/** Open /slug/<zone>, wait for the new document, press ENTER ZONE and wait for control.
 * @param {Page} page @param {URL} base @param {string} zone @returns {Promise<Boot>} */
async function boot(page, base, zone) {
  const before = Number(await settled(() => page.evaluate('return performance.timeOrigin;')));
  await settled(() => page.navigate(new URL(`/slug/${zone}`, base).href), 3);
  await pause(1500);
  for (const end = Date.now() + 30_000; Math.abs(Number(await settled(() => page.evaluate('return performance.timeOrigin;'))) - before) <= 5; await pause(300)) {
    assert(Date.now() < end, 'the page was not replaced');
  }
  const driver = /** @type {any} */ (page);
  const entryBy = Date.now() + 90_000;
  let button;
  while (!(button = await settled(() => findButton(driver, ['enter zone', 'enter world', 'play'])))) { assert(Date.now() < entryBy, 'no ENTER ZONE'); await pause(400); }
  await watchPageErrors(driver);
  const start = Date.now();
  await page.click(/** @type {{ el: { __wsElement: number } }} */ (button).el);
  const result = await waitForControl(driver, start, 180_000, () => undefined);
  // entering may move the page (the slug page to /), so the boot's document is the one at control
  return { outcome: result.outcome, clickToControlMs: result.controlAt === null ? null : result.controlAt - start, error: result.state?.error ?? null,
    controlAt: new Date().toISOString(), timeOrigin: Number(await page.evaluate('return performance.timeOrigin;')) };
}

/** Ask the warm page every second for `seconds`: a kill shows as no answer, or Safari's reload as another document.
 * @param {Page} page @param {Boot} warm @param {number} seconds */
async function hold(page, warm, seconds) {
  warm.hold = { seconds, answered: 0, lost: null };
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await pause(1000)) {
    try {
      const origin = Number(await settled(() => page.evaluate('return performance.timeOrigin;'), 1));
      if (Math.abs(origin - Number(warm.timeOrigin)) > 5) { warm.hold.lost = { at: new Date().toISOString(), why: 'another document (a reload)' }; return; }
      warm.hold.answered++;
    } catch (error) { warm.hold.lost = { at: new Date().toISOString(), why: String(error) }; return; }
  }
}

async function main() {
  assert(process.env['WS_PHONE_JOB'], 'warm-return runs through the MD1 phone queue (phone-queue.mjs submit)');
  const { values } = parseArgs({ options: { base: { type: 'string' }, zone: { type: 'string', default: 'driftwood-isle' },
    arms: { type: 'string', default: 'hop,hop,hop' }, hold: { type: 'string', default: '40' }, out: { type: 'string' } } });
  assert(values.base !== undefined, '--base <origin> is required');
  const base = new URL(values.base), zone = values.zone, arms = values.arms.split(',');
  assert(arms.every(arm => arm === 'hop' || arm === 'direct'), '--arms is a list of hop and direct');
  const out = resolve(values.out ?? `tmp/warm-return/${new Date().toISOString().replaceAll(/[:.]/gu, '-')}`);
  mkdirSync(out, { recursive: true });
  /** @type {Record<string, unknown> & { rounds: Record<string, unknown>[] }} */
  const report = { job: process.env['WS_PHONE_JOB'], base: base.href, zone, startedAt: new Date().toISOString(), rounds: [] };
  const save = () => { writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); };
  report['phone'] = doctor({ udid: UDID, sharedPort: '4444' });
  for (const [index, arm] of arms.entries()) {
    const dir = join(out, `round-${String(index + 1)}`);
    mkdirSync(dir, { recursive: true });
    /** @type {Record<string, any>} */ const round = { n: index + 1, arm, startedAt: new Date().toISOString() };
    report.rounds.push(round); save();
    const inspector = await startInspector(UDID, { launchUrl: new URL('/version.json', base).href });
    /** @type {Page | undefined} */ let page;
    const log = deviceLog(dir);
    try {
      page = await inspector.fresh();
      // a cold origin: no saves, workers, caches or databases, then the phone's slots (Low, phone tier, no first-play prompts)
      const fresh = page;
      await fresh.navigate(new URL('/version.json', base).href);
      await fresh.evaluate(`window.__wsReset = { done: false }; (async () => { localStorage.clear(); sessionStorage.clear();
        await Promise.all((await navigator.serviceWorker?.getRegistrations() ?? []).map(w => w.unregister()));
        await Promise.all((await globalThis.caches?.keys() ?? []).map(k => caches.delete(k)));
        await Promise.all(((await indexedDB.databases?.()) ?? []).filter(d => d.name).map(d => new Promise(r => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })));
        window.__wsReset.done = true; })().catch(e => { window.__wsReset = { done: true, error: String(e) }; }); return true;`);
      for (const end = Date.now() + 45_000; ; await pause(500)) {
        const reset = /** @type {{ done: boolean, error?: string } | null} */ (await fresh.evaluate('return window.__wsReset;'));
        if (reset?.done === true) { assert(reset.error === undefined, reset.error); break; }
        assert(Date.now() < end, 'the origin reset did not finish');
      }
      await fresh.evaluate(`const write = (${writeSaveFixture.toString()}); for (const f of arguments[0]) write(f); return true;`, [phoneSlots({ graphics: 'low' })]);
      round['pidsStart'] = webContentPids(join(dir, 'pids-start.json'));
      round['cold'] = await boot(fresh, base, zone);
      round['pidsCold'] = webContentPids(join(dir, 'pids-cold.json')); save();
      if (round['cold'].outcome !== 'control') throw new Error(`cold boot: ${String(round['cold'].outcome)}`);
      await pause(5000);
      if (arm === 'hop') { await settled(() => fresh.navigate(new URL('/robots.txt', base).href), 3); await pause(300); }
      round['warm'] = await boot(fresh, base, zone);
      round['pidsWarm'] = webContentPids(join(dir, 'pids-warm.json')); save();
      if (round['warm'].outcome === 'control') await hold(fresh, round['warm'], Number(values.hold));
      round['pidsEnd'] = webContentPids(join(dir, 'pids-end.json'));
    } catch (error) { round['error'] = String(error); console.error(`round ${String(index + 1)}:`, error); }
    finally {
      round['finishedAt'] = new Date().toISOString();
      await log.stop();
      round['jetsam'] = jetsamReports(dir, String(round['startedAt']), String(round['finishedAt']));
      const timeline = visibleTimeline(log.lines);
      round['visible'] = {
        cold: round['cold']?.controlAt === undefined ? null : visibleAt(timeline, new Date(round['cold'].controlAt)),
        warm: round['warm']?.controlAt === undefined ? null : visibleAt(timeline, new Date(round['warm'].controlAt)),
        timeline,
      };
      const killed = /** @type {{ killed?: { name: string, pid: number, bytes: number, reason: string }[] }[]} */ (round['jetsam'])
        .flatMap(r => r.killed ?? []).filter(k => /WebContent/u.test(k.name));
      round['webContentKilled'] = killed;
      round['pass'] = round['warm']?.outcome === 'control' && round['warm']?.hold?.lost === null && killed.length === 0;
      if (page !== undefined) { await page.navigate('about:blank').catch(() => undefined); await page.close().catch(() => undefined); }
      await inspector.stop();
      save();
      console.log(JSON.stringify({ round: index + 1, arm, cold: round['cold']?.outcome ?? null, warm: round['warm']?.outcome ?? null,
        warmMs: round['warm']?.clickToControlMs ?? null, held: round['warm']?.hold ?? null, visible: { cold: round['visible'].cold, warm: round['visible'].warm },
        killed: killed.map(k => `${k.name}[${String(k.pid)}] ${String(Math.round(k.bytes / 1_048_576))} MB ${k.reason}`), pass: round['pass'], error: round['error'] ?? null }));
    }
  }
  report['finishedAt'] = new Date().toISOString(); save();
  const passed = report.rounds.filter(r => r['pass'] === true).length;
  console.log(`warm-return: ${String(passed)} of ${String(arms.length)} rounds passed (${out}/report.json)`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
