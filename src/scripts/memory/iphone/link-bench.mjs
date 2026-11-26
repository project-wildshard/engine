#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW6 (mini-driftwood13, 2026-11-19): the time from the link to control, stage by stage, the way a
// player gets there: open the origin, the title's ZONE SELECT, the zone's card, ENTER ZONE, then the loading card's
// START, DOWNLOAD and LOAD phases, then control (safari.mjs's control predicate).
//
//   node src/scripts/memory/iphone/link-bench.mjs [--zone driftwood-isle] [--runs 5] [--warm 5] [--base <origin>]
//     [--driver inspector|webkit] [--cool-to <°C>] [--lock-log <file>] [--profile-op <operation>] [--profile-max <s>]
//     [--shot <s>] [--out <dir>] [--dry-run]
//
// Cold: a fresh Safari (fresh WebKit on the Mac), the origin's storage, service worker, caches and IndexedDB cleared, and
// the inspector's resource cache off for the boot (Safari's HTTP cache cannot be emptied without a finger). Warm: the
// same fresh Safari, everything kept from the run before. Phone Low is seeded both ways (safari.mjs phoneSlots).
// On the phone (mini-dw-boot, 2026-11-20): the battery cools to --cool-to (35 °C) before the phone locks are taken, so a
// cooling bench never holds the shared phone; every devicectl launch logs lockState before and after (a locked phone stops
// the bench), and each boot asks for the Screen Wake Lock through the inspector's emulateUserGesture.
// --profile-op game-stage:home samples WebKit's ScriptProfiler while that boot operation is active (at most --profile-max s,
// default 4: a long sample overflows the inspector socket), into profile-<run>.json beside link.json. A profiled boot is
// slower, so its times are not the stage table's.
// --shot <s>: a devicectl screenshot <s> seconds after control (shot-<run>.png), the same spawn view for a look board (J430).
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { coldOrigin, findButton, pageState, watchPageErrors } from './safari.mjs';
import { bootTimelineEntries } from '../../loading-flow/stalls.mjs';
import { linkTable } from './link.mjs';
import { askWake } from './route.mjs';
import { lockKind, underLock } from './locks.mjs';

const { values } = parseArgs({ options: {
  zone: { type: 'string', default: 'driftwood-isle' }, runs: { type: 'string', default: '5' }, warm: { type: 'string', default: '5' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, driver: { type: 'string', default: 'inspector' },
  out: { type: 'string' }, udid: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
  'cool-to': { type: 'string', default: '35' }, 'profile-op': { type: 'string' }, 'profile-max': { type: 'string', default: '4' }, shot: { type: 'string' }, 'lock-log': { type: 'string', default: 'tmp/iphone13/lockstate.log' },
} });
const cold = Number(values.runs), warm = Number(values.warm), base = new URL(values.base).href;
if (!Number.isSafeInteger(cold) || cold < 1 || !Number.isSafeInteger(warm) || warm < 0) throw new Error('--runs is at least 1, --warm at least 0');
const out = resolve(values.out ?? join('tmp/iphone13', `link-${values.zone}-${String(Date.now())}`));
const name = values.zone.replaceAll('-', ' ');

/** One boot from the origin to control, every stage timed from the navigation. @param {any} driver @param {string} [profileFile] */
async function linkRun(driver, profileFile) {
  /** @type {Record<string, number|null>} */
  const at = { menu: null, deck: null, enter: null, startShown: null, startDone: null, downloadShown: null, downloadDone: null, loadShown: null, loadDone: null, control: null };
  const t0 = Date.now(), since = () => (Date.now() - t0) / 1000;
  await driver.navigate(base);
  if (typeof driver.gesture === 'function') await driver.gesture(askWake).catch(() => undefined);
  await watchPageErrors(driver).catch(() => undefined);
  const deadline = t0 + 300_000;
  /** @type {any} */
  let state = null;
  let tappedSelect = 0, tappedEnter = 0, origin;
  /** @type {number|null} */
  let profiling = null;
  const profileOp = values['profile-op'], profileMax = Number(values['profile-max']) * 1000;
  const stopProfile = async () => {
    if (profiling === null || profileFile === undefined) return;
    profiling = null;
    const samples = await driver.profileStop().catch((/** @type {unknown} */ error) => { console.log(`  profile: ${String(error)}`); return []; });
    writeFileSync(profileFile, JSON.stringify(samples));
    console.log(`  profile: ${String(samples.length)} samples in ${profileFile}`);
  };
  while (Date.now() < deadline) {
    state = await driver.evaluate(pageState);
    if (state.timeOrigin !== origin) {
      // a new document drops the wake lock and the error hooks: ask again
      origin = state.timeOrigin;
      await watchPageErrors(driver).catch(() => undefined);
      if (typeof driver.gesture === 'function') await driver.gesture(askWake).catch(() => undefined);
    }
    if (state.error) return { at, error: state.error, state };
    if (state.control) { at.control = since(); await stopProfile(); break; }
    if (profileOp !== undefined && profileFile !== undefined && typeof driver.profileStart === 'function') {
      const active = await driver.evaluate('return (window.__bootTiming?.read?.().active ?? []).some((row) => row.operation === arguments[0]);', [profileOp]).catch(() => false);
      if (active === true && profiling === null && !existsSync(profileFile)) { profiling = Date.now(); await driver.profileStart(); }
      else if (profiling !== null && (active !== true || Date.now() - profiling > profileMax)) await stopProfile();
    }
    if (at.enter === null) {
      const enter = await findButton(driver, ['enter zone']);
      const select = enter === null ? await findButton(driver, ['zone select']) : null;
      if (select !== null && at.menu === null) at.menu = since();
      if (select !== null && Date.now() - tappedSelect > 4_000) { tappedSelect = Date.now(); await driver.click(select.el); }
      if (enter !== null) {
        at.deck ??= since();
        // the zone's own card first (Driftwood is the deck's first, selected card today; others need the tap)
        await driver.evaluate(`for (const el of document.querySelectorAll('.ws-menu-card')) if (el.innerText.toLowerCase().includes(arguments[0])) { if (!el.classList.contains('selected')) el.click(); return; }`, [name]);
        if (Date.now() - tappedEnter > 6_000) { tappedEnter = Date.now(); at.enter ??= since(); await driver.click(enter.el); }
      }
    } else {
      for (const [key, phase] of /** @type {const} */ ([['start', 'st'], ['download', 'dl'], ['load', 'su']])) {
        const pct = state.phases?.[phase]?.pct;
        if (pct !== undefined && pct !== null && pct !== '—' && pct !== '') at[`${key}Shown`] ??= since();
        if (pct === '100') at[`${key}Done`] ??= since();
      }
      // a ready card's own buttons (Skip, Play anyway) are a player's taps too
      const follow = await findButton(driver, ['skip', 'play anyway']);
      if (follow) await driver.click(follow.el);
    }
    await pause(250);
  }
  const spans = at.control === null ? [] : await driver.evaluate(`return (${bootTimelineEntries.toString()})();`).catch(() => []);
  const wake = await driver.evaluate("return 'wakeLock' in navigator ? (window.__wsRouteWakeAsk ? 'asked' : 'not asked') : 'unsupported';").catch(() => 'unread');
  return { at, wake, phaseTimes: state?.phaseTimes ?? null, error: at.control === null ? 'never reached control in 300 s' : null, version: state?.version ?? null, build: state?.build ?? null,
    lastPhases: state?.phases ?? null, spans, consoleErrors: state?.consoleErrors ?? [] };
}

/** The phone's battery temperature and lock state, read without a session (idevicediagnostics, devicectl). */
async function phoneReads() {
  const { batteryTemperature, command } = await import('./doctor.mjs');
  const udid = values.udid ?? '00008110-000A35C61E90401E';
  const lockLog = resolve(values['lock-log']);
  mkdirSync(dirname(lockLog), { recursive: true });
  const reading = () => batteryTemperature(command('idevicediagnostics', ['-u', udid, 'ioregentry', 'AppleSmartBattery']).output)?.celsius ?? null;
  return {
    reading,
    /** @param {string} label */
    lockState(label) {
      const done = command('xcrun', ['devicectl', 'device', 'info', 'lockState', '--device', udid]);
      const passcode = /passcodeRequired:\s*(\w+)/u.exec(done.output)?.[1] ?? 'unread';
      appendFileSync(lockLog, `${new Date().toISOString()} link-bench ${label} passcodeRequired=${passcode}\n`);
      if (passcode === 'true') throw new Error(`PHONE LOCKED at ${label} (lockState in ${lockLog}): stop touching the phone`);
    },
    /** Wait (at most `maxMs`) for the battery to fall to --cool-to °C. */
    async cool(maxMs = 10 * 60_000) {
      const line = Number(values['cool-to']), deadline = Date.now() + maxMs;
      let now = reading();
      while (now !== null && now > line && Date.now() < deadline) {
        console.log(`cooling: ${String(now)} °C against ${String(line)} °C`);
        await pause(15_000);
        now = reading();
      }
      return now;
    },
  };
}

async function bench() {
  mkdirSync(out, { recursive: true });
  const phone = values.driver === 'inspector';
  /** @type {any} */
  let tools = null;
  if (phone) {
    const { doctor } = await import('./doctor.mjs');
    const { startInspector } = await import('./inspector.mjs');
    const facts = doctor({ udid: values.udid, sharedPort: '4444' });
    tools = { facts, reads: await phoneReads(), inspector: await startInspector(facts.udid, { launchUrl: new URL('/robots.txt', base).href }) };
  }
  /** @type {any[]} */
  const rows = [];
  /** @type {any} */
  let browser = null;
  try {
    for (let i = 0; i < cold + warm; i++) {
      const kind = i < cold ? 'cold' : 'warm';
      /** @type {any} */
      let driver;
      // the first run was cooled before the locks; later ones cool at most 3 min while holding them (the desktop benches wait)
      const temperature = phone ? (i === 0 ? tools.reads.reading() : await tools.reads.cool(3 * 60_000)) : null;
      if (phone) {
        tools.reads.lockState(`${kind} ${String(i + 1)} before devicectl launch`);
        driver = await tools.inspector.fresh();
        tools.reads.lockState(`${kind} ${String(i + 1)} after devicectl launch`);
      }
      else {
        // desktop: a new browser per cold run (an empty HTTP cache); the warm runs share the last cold run's browser
        if (kind === 'cold' || browser === null) { await browser?.stop(); const { startWebKit } = await import('./webkit.mjs'); browser = await startWebKit(); }
        driver = browser;
      }
      if (kind === 'cold') {
        await coldOrigin(driver, base, {});
        if (typeof driver.cacheOff === 'function') await driver.cacheOff(true);
      } else if (typeof driver.cacheOff === 'function') await driver.cacheOff(false);
      /** @type {any} */
      let row;
      try { row = { kind, temperature, ...await linkRun(driver, values['profile-op'] === undefined ? undefined : join(out, `profile-${String(i + 1)}.json`)) }; } catch (error) { row = { kind, temperature, at: {}, error: error instanceof Error ? error.message : String(error) }; }
      if (phone && values.shot !== undefined && row.at?.control !== null && row.at?.control !== undefined) {
        await pause(Number(values.shot) * 1000);
        const { takeScreenshot } = await import('./record.mjs');
        row.shot = join(out, `shot-${String(i + 1)}.png`);
        await takeScreenshot(tools.facts.udid, row.shot).catch((/** @type {unknown} */ error) => { row.shot = `error: ${String(error)}`; });
      }
      if (phone) tools.reads.lockState(`${kind} ${String(i + 1)} after run`);
      console.log(`${kind} ${String(i + 1)}: ${row.error ?? `control ${String(row.at.control)} s`} ${JSON.stringify(row.at)}`);
      rows.push(row);
      await driver.close?.().catch(() => undefined);
      writeFileSync(join(out, 'link.json'), JSON.stringify(rows, null, 2));
    }
  } finally {
    await tools?.inspector.stop();
    await browser?.stop();
  }
  const text = [`# ${values.zone}: link to control`, '', `${values.driver} · ${base} · ${new Date().toISOString()}`, '', linkTable(rows)].join('\n');
  writeFileSync(join(out, 'link.md'), text);
  console.log(text);
}

if (values['dry-run']) console.log(JSON.stringify({ zone: values.zone, cold, warm, base, driver: values.driver, out }, null, 2));
else if (!values['with-locks']) {
  // MINI-DEVEX MD2: the phone holds iphone13.lock only; the desktop proxy holds desktop-gpu.lock (locks.mjs)
  const kind = lockKind(values.driver);
  // MD1: a phone run is a job for the phone runner, which cools to --cool-to before it takes the lock, so a cooling bench
  // never holds the shared phone
  process.exitCode = await underLock(kind, import.meta.filename, [...process.argv.slice(2), '--out', out, '--with-locks'], { coolTo: Number(values['cool-to']) });
} else await bench();
