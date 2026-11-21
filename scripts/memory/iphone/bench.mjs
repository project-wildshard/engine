#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { deviceSavePicks } from '../../debug-settings.mjs';
import { batteryTemperature, command, doctor } from './doctor.mjs';
import { frameSummary, readFrames } from './frames.mjs';
import { underPhoneLocks } from './locks.mjs';
import { activityMonitor, footprintWindow, pullJetsam, startReaders, takeScreenshot } from './record.mjs';
import { attachSafari, enterZone, openSharedSafari, readRecovery, startSafari, WebDriverError } from './safari.mjs';
import { startInspector } from './inspector.mjs';
import { stairs, stairKinds } from './staircase.mjs';
import { sweep } from './sweep.mjs';

const args = process.argv.slice(2);
const release = args[0] === '--suite' && args[1] === 'release';
const { values } = parseArgs({ args: release ? [] : args, options: {
  zone: { type: 'string', default: 'brasscap-mesa' }, mode: { type: 'string', default: 'boot' },
  runs: { type: 'string', default: '1' }, slots: { type: 'string', multiple: true }, pair: { type: 'boolean' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, udid: { type: 'string' },
  webdriver: { type: 'string' }, session: { type: 'string' }, trace: { type: 'string' },
  'idle-celsius': { type: 'string' }, out: { type: 'string' }, seconds: { type: 'string' },
  'reload-at': { type: 'string' }, driver: { type: 'string', default: 'webdriver' }, override: { type: 'string', multiple: true },
  probe: { type: 'string' },
  'dry-run': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
} });

const mode = values.mode, runs = Number(values.runs), base = new URL(values.base).href;
const duration = values.seconds === undefined ? mode === 'walk' ? 60 : mode === 'soak' ? 600 : 30 : Number(values.seconds);
const reloadAt = values['reload-at'] === undefined ? undefined : Number(values['reload-at']) * 1000;
if (!['boot', 'walk', 'soak', 'sweep', 'staircase'].includes(mode) ||
  !Number.isSafeInteger(runs) || runs < 1 ||
  !Number.isSafeInteger(duration) || duration < 1 || (mode === 'boot' && duration < 30) ||
  (reloadAt !== undefined && (!Number.isFinite(reloadAt) || reloadAt <= 0 || mode !== 'boot')) ||
  (values.pair && (values.slots === undefined || !['boot', 'walk', 'soak'].includes(mode)))) {
  throw new Error('Expected boot|walk|soak|sweep|staircase, positive runs and seconds, at least 30 s for boot, and slots with --pair');
}
if (!['webdriver', 'inspector'].includes(values.driver) || (values.override !== undefined && values.driver !== 'inspector')) {
  throw new Error('--driver is webdriver or inspector; --override <url part>=<file> needs --driver inspector');
}
// Web Inspector local overrides: a request whose URL contains the part is answered with the file (inspector.mjs).
const localBodies = (values.override ?? []).map((pick) => {
  const at = pick.lastIndexOf('=');
  if (at < 1) throw new Error('--override is <url part>=<file>');
  return { pattern: pick.slice(0, at), file: resolve(pick.slice(at + 1)) };
});
const slots = Object.fromEntries(Object.entries(deviceSavePicks(values.slots ?? [])).map(([key, text]) => {
  try { return [key, JSON.parse(text)]; } catch { return [key, text]; }
}));
const endpoint = values.webdriver ?? process.env.WS_IPHONE_WEBDRIVER;
const session = values.session ?? process.env.WD_SESSION;
if (!release && session !== undefined && endpoint === undefined) throw new Error('a session ID needs --webdriver http://127.0.0.1:PORT');
const udid = values.udid, sharedPort = endpoint === undefined ? undefined : new URL(endpoint).port;
const out = resolve(values.out ?? join('tmp/iphone13', `bench-${Date.now()}`));
const benchScript = import.meta.filename;
/** @typedef {import('./safari.mjs').Safari} Safari */

/** @param {Safari} driver @param {string} directory @param {Record<string,unknown>} overrides
 * @param {(path:string) => Promise<void>} capture */
async function zoneRun(driver, directory, overrides, capture) {
  /** @type {{at:number, phases:import('./safari.mjs').PageState['phases']}[]} */
  const saw = [];
  /** @type {import('./safari.mjs').PageState | undefined} */
  let last;
  /** @type {Awaited<ReturnType<typeof enterZone>> | undefined} */
  let boot;
  /** @type {Awaited<ReturnType<typeof readFrames>> | undefined} */
  let frames;
  /** @type {Awaited<ReturnType<typeof readFrames>> | undefined} */
  let standing;
  /** @type {unknown} */
  let probe = null;
  let screenshot = null;
  let screenshotError = null;
  let error = null;
  const openedAt = Date.now();
  try {
    boot = await enterZone(driver, { base, slug: values.zone, slots: overrides, reloadAt, observe: (state) => {
      last = state;
      saw.push({ at: Date.now(), phases: state.phases });
    } });
    if (boot.outcome === 'control') {
      // --probe: one page expression read at control, kept in the report (e.g. which arm an override applied)
      if (values.probe !== undefined) probe = await driver.evaluate(`return (${values.probe});`);
      if ('quiet' in driver && typeof driver.quiet === 'function') await driver.quiet();
      // a walk first stands its 30 s at spawn, sampled (IP34 reads both)
      if (mode === 'walk') standing = await readFrames(driver, { slug: values.zone, seconds: 30, walk: false });
      else if (mode !== 'boot') await pause(30_000);
      frames = await readFrames(driver, { slug: values.zone, seconds: duration, walk: mode !== 'boot' });
      if (mode === 'walk') {
        for (let i = 0; i < frames.samples.length; i += 10) {
          console.log(JSON.stringify({ second: i + 10, ...frameSummary(frames.samples.slice(i, i + 10)) }));
        }
      }
    }
  } catch (cause) {
    error = { message: cause instanceof Error ? cause.message : String(cause),
      code: cause instanceof WebDriverError ? cause.code : null };
  }
  try {
    if (last !== undefined) {
      const path = join(directory, boot?.outcome === 'control' ? 'control.png' : 'last.png');
      await capture(path);
      screenshot = path;
    }
  } catch (cause) { screenshotError = String(cause); }
  return { openedAt, boot, last, saw, probe, standing, frames, screenshot, screenshotError, error };
}

/** @param {number|null|undefined} bytes */
const mb = (bytes) => typeof bytes === 'number' && Number.isFinite(bytes) ? (bytes / 1e6).toFixed(1) : '—';

async function bench() {
  // The inspector driver opens no WebDriver session; the mini's shared listener (:4444) may keep running beside it.
  const facts = doctor({ udid, sharedPort: values.driver === 'inspector' ? sharedPort ?? '4444' : sharedPort });
  const temperatureNow = () => batteryTemperature(command('idevicediagnostics', ['-u', facts.udid, 'ioregentry', 'AppleSmartBattery']).output);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
  const inspector = values.driver === 'inspector' ? await startInspector(facts.udid, { launchUrl: new URL('/robots.txt', base).href,
    overrides: localBodies.map(({ pattern, file }) => ({ pattern, body: readFileSync(file, 'utf8') })) }) : null;
  const standalone = endpoint === undefined && inspector === null ? await startSafari(facts.udid) : null;
  /** @returns {Promise<Safari>} */
  const open = () => inspector !== null ? /** @type {Promise<Safari>} */ (/** @type {unknown} */ (inspector.open())) :
    standalone !== null ? standalone.open() : openSharedSafari(/** @type {string} */ (endpoint), facts.udid);
  const capture = (/** @type {string} */ path) => takeScreenshot(facts.udid, path);
  /** @type {Safari | null} */
  let driver = null;
  try {
    driver = endpoint !== undefined && session !== undefined ? await attachSafari(endpoint, session) : await open();
    if (mode === 'sweep') {
      await sweep({ driver, base, out, capture, recover: async () => {
        if (driver !== null) {
          try {
            await driver.getUrl();
            return driver;
          } catch {
            await driver.close().catch(() => undefined);
          }
        }
        driver = await open();
        return driver;
      } });
      return;
    }
    if (values['idle-celsius'] === undefined) {
      await driver.navigate('about:blank');
      console.log('Settling the iPhone at a blank page for the idle battery reading');
      await pause(60_000);
    }
    const idle = values['idle-celsius'] === undefined ?
      temperatureNow()?.celsius : Number(values['idle-celsius']);
    if (idle === undefined || !Number.isFinite(idle)) throw new Error('No idle battery temperature reading from the phone');
    const report = [];
    const trials = Array.from({ length: runs * (values.pair ? 2 : 1) }, () => mode === 'staircase' ? stairKinds : [null]).flat();
    const { udid: _udid, ...deviceFacts } = facts;
    writeFileSync(join(out, 'environment.json'), JSON.stringify({ ...deviceFacts, idleCelsius: idle, base, mode, driver: values.driver,
      overrides: localBodies.map(({ pattern, file }) => ({ pattern, file })) }, null, 2));
    for (const [index, kind] of trials.entries()) {
      // the last boot's zone is still drawing in Safari's tab: park the tab, or the phone heats while it "cools"
      if (inspector !== null) {
        driver ??= await open().catch(() => null);
        await driver?.navigate(new URL('/robots.txt', base).href).catch(() => undefined);
      }
      const deadline = Date.now() + 10 * 60_000;
      let temperature = temperatureNow();
      while (temperature === null || Math.abs(temperature.celsius - idle) > 2) {
        if (Date.now() >= deadline) throw new Error('iPhone did not return within 2 °C of its idle temperature');
        console.log('Cooling iPhone to within 2 °C of idle');
        await pause(15_000);
        temperature = temperatureNow();
      }
      const directory = join(out, kind !== null && runs === 1 ? kind : `run-${index + 1}`);
      const readingsFor = 30 + (mode === 'boot' ? 0 : 30) + duration + 240;
      if (inspector !== null) {
        // every trial in a fresh Safari on the zone's origin, before sysmon starts (it follows the processes alive at its
        // start): a fresh WebContent, so no earlier boot's memory rides along (inspector.mjs fresh)
        await driver?.close().catch(() => undefined);
        driver = /** @type {Safari} */ (/** @type {unknown} */ (await inspector.fresh()));
      }
      const readers = startReaders({ udid: facts.udid, out: directory, seconds: readingsFor, trace: values.trace });
      const start = Date.now();
      let zone, staircase;
      let raw;
      let fault = null;
      const overrides = values.pair && index % 2 === 0 ? {} : slots;
      try {
        await pause(1500); // let sysmon observe the old tab's PID before replacing it
        driver ??= await open();
        if (kind !== null) staircase = await stairs(driver, { base, kind, log: join(directory, 'steps.jsonl') });
        else zone = await zoneRun(driver, directory, overrides, capture);
      } catch (error) {
        fault = error instanceof Error ? error.message : String(error);
      } finally {
        if (kind !== null && driver !== null) await driver.navigate('about:blank').catch(() => undefined);
        raw = await readers.stop();
      }
      const openedAt = zone?.openedAt ?? staircase?.startedAt ?? start;
      const controlAt = zone?.boot?.controlAt ?? null;
      const measurements = Object.fromEntries(Object.entries(raw.series).map(([name, rows]) =>
        [name, footprintWindow(rows, openedAt, controlAt)]));
      const activity = values.trace === 'Activity Monitor'
        ? activityMonitor(raw.trace, Object.values(measurements).flatMap(({ pid }) => pid === null ? [] : [pid])) : null;
      const activityMeasurements = activity === null ? null : {
        error: activity.error,
        measurements: Object.fromEntries(Object.entries(measurements).map(([name, reading]) => {
          const activityReading = footprintWindow(activity.series.filter(row => row.pid === reading.pid), openedAt, controlAt);
          const a = activityReading.settledBytes, b = reading.settledBytes;
          return [name, { ...activityReading, settledDifferencePct: a !== null && b !== null && b > 0 ? 100 * (a - b) / b : null }];
        })),
      };
      let jetsam;
      try { jetsam = await pullJetsam({ udid: facts.udid, out: directory, since: start }); }
      catch (error) { jetsam = { error: String(error) }; }
      const scope = session !== undefined && driver?.sessionId === session ? 'attached session' : 'owned session';
      let recovery = null;
      const disconnected = zone?.error?.code === 'invalid session id' || zone?.error?.code === 'no such window' || staircase?.outcome === 'driver-error';
      if (disconnected || zone?.boot?.reloaded === true) {
        try {
          if (disconnected) {
            await driver?.close().catch(() => undefined);
            driver = null;
            driver = await open();
          }
          if (driver !== null) recovery = await readRecovery(driver, base, ['devMode', 'graphics', ...Object.keys(overrides)]);
        } catch (error) { recovery = { error: String(error) }; }
      }
      const row = { trial: kind ?? index + 1, mode, zoneSlug: kind === null ? values.zone : null, scope,
        slots: overrides, temperature, measurements, jetsam, limits: raw.limits, readerStatus: raw.statuses,
        trace: raw.trace, activityMonitor: activityMeasurements, zone, staircase, fault, recovery,
        // inspector overrides answered during this trial (none under WebDriver)
        overridden: localBodies.length === 0 ? null : (/** @type {{served?: {url: string, at: number}[]}} */ (driver ?? {})).served?.filter(({ at }) => at >= start).map(({ url }) => url) ?? null };
      report.push(row);
      writeFileSync(join(directory, 'report.json'), JSON.stringify(row, null, 2));
      writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
      const failure = zone?.error?.message ?? fault;
      if (failure?.startsWith('PHONE LOCKED:')) throw new Error(failure);
      if (session === undefined) {
        await driver?.close().catch(() => undefined);
        driver = null;
      }
    }
    console.log('| Trial | Outcome | WebContent peak / settled MB [K] | GPU peak / settled MB [K] | Load s | FPS |');
    console.log('|---|---|---|---|---:|---:|');
    for (const row of report) {
      const web = row.measurements['com.apple.WebKit.WebContent'], gpu = row.measurements['com.apple.WebKit.GPU'];
      const boot = row.zone?.boot;
      const load = typeof boot?.controlAt === 'number' && typeof boot.startedAt === 'number' ?
        ((boot.controlAt - boot.startedAt) / 1000).toFixed(1) : '—';
      const cell = (/** @type {typeof web} */ m) => `${mb(m?.peakBytes)} / ${mb(m?.settledBytes)}`;
      const outcome = row.fault !== null || row.zone?.error ? 'driver or capture error' : row.staircase?.outcome ?? boot?.outcome ?? 'unknown';
      console.log(`| ${row.trial} | ${outcome} | ${cell(web)} | ${cell(gpu)} | ${load} | ${row.zone?.frames?.summary.fps?.toFixed(1) ?? '—'} |`);
    }
  } finally {
    await driver?.close().catch(() => undefined);
    await standalone?.stop();
    await inspector?.stop();
  }
}

if (release) {
  const { releaseSuite } = await import('./release.mjs');
  process.exitCode = await releaseSuite(args.slice(2), { script: benchScript, lock: underPhoneLocks });
} else if (values['dry-run']) {
  console.log('Under iphone13.lock: doctor, Safari driver, native readers, screenshots and report');
  console.log(JSON.stringify({ base, mode, zone: values.zone, runs, seconds: duration, reloadAt, pair: values.pair ?? false, slots, out, trace: values.trace,
    driver: values.driver, overrides: localBodies }));
} else if (!values['with-locks']) {
  process.exitCode = await underPhoneLocks(benchScript, [...args, '--out', out, '--with-locks']);
} else {
  await bench();
}
