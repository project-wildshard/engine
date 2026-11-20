#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): one command runs a zone's route bench cold and writes a table.
//
//   node scripts/memory/iphone/route-bench.mjs [--zone driftwood-isle] [--route <name>] [--runs 3] [--caps 30,60] [--base <origin>]
//     [--driver inspector|webkit] [--slots key=value ...] [--rec <segment> ...] [--legs <n>] [--ab <slot>] [--profile <s>] [--profile-delay <s>] [--cool-to <°C>] [--census] [--voices] [--frames] [--out <dir>] [--dry-run]
//
// --route plays another of route.mjs's routes in the zone (DF2's turning `driftwood-fps`); the default is the zone's own.
// --census reads, at the route's end, which owners draw the triangles in each pass (census.mjs), on the device itself.
// --voices times every procedural voice render from the wake lock to the route's end (census.mjs), with the page clock.
// --frames logs every frame over 45 ms from the wake lock to the route's end with the links, uploads and scene adds in it,
// and on the phone JavaScriptCore's collections (the inspector's Heap agent), then names each frame over 50 ms's cause.
// --slots graphics=high runs phone High. --rec presses the game's REC 30 S over the named segments (DW2's frame split). --legs n plays the first n segments only.
//
// Each run plays the route (route.mjs) once per cap, each from its own cold boot (fresh Safari on the phone, a fresh WebKit
// on the Mac; origin storage cleared, phone Low seeded), so every pass starts at the dock; the cap order alternates run to run. The phone runs under
// iphone13.lock then mini-measure.lock, with no WebDriver session: devicectl opens Safari and Web Inspector drives it
// (inspector.mjs). `--driver webkit` is the desktop proxy (headless WebKit as an iPhone 13) under mini-measure.lock.
// Output: <out>/route.json (every leg's samples) and <out>/route.md (one row per run, cap and segment, then the worst).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { deviceSavePicks } from '../../debug-settings.mjs';
import { enterZone } from './safari.mjs';
import { FRAME_LOG_READ, FRAME_LOG_START, gapWork, nameLongFrames, otherKind, OWNER_CENSUS, VOICE_LOG_READ, VOICE_LOG_START, VOICE_WORKER_READ } from './census.mjs';
import { askWake, holdWake, unlockAudio, playRoute, routeFor, routeTable, worstSegment } from './route.mjs';

const { values } = parseArgs({ options: {
  zone: { type: 'string', default: 'driftwood-isle' }, route: { type: 'string' }, runs: { type: 'string', default: '3' }, caps: { type: 'string', default: '30,60' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, driver: { type: 'string', default: 'inspector' },
  slots: { type: 'string', multiple: true }, 'lock-log': { type: 'string', default: 'tmp/iphone13/lockstate.log' }, rec: { type: 'string', multiple: true }, legs: { type: 'string' }, ab: { type: 'string' }, profile: { type: 'string' }, 'profile-delay': { type: 'string' }, 'cool-to': { type: 'string' }, out: { type: 'string' }, udid: { type: 'string' },
  'dry-run': { type: 'boolean' }, census: { type: 'boolean' }, voices: { type: 'boolean' }, 'cache-off': { type: 'boolean' }, frames: { type: 'boolean' }, 'with-locks': { type: 'boolean' },
} });
const runs = Number(values.runs), caps = /** @type {(30|60)[]} */ (values.caps.split(',').map(Number));
if (!Number.isSafeInteger(runs) || runs < 1 || caps.length === 0 || caps.some((cap) => cap !== 30 && cap !== 60)) throw new Error('--runs is a positive integer, --caps a list of 30 and 60');
if (!['inspector', 'webkit'].includes(values.driver)) throw new Error('--driver is inspector (the iPhone) or webkit (the desktop proxy)');
const route = values.route ?? values.zone;
routeFor(route);
const base = new URL(values.base).href;
const slots = Object.fromEntries(Object.entries(deviceSavePicks(values.slots ?? [])).map(([key, text]) => {
  try { return [key, JSON.parse(text)]; } catch { return [key, text]; }
}));
const out = resolve(values.out ?? join('tmp/iphone13', `route-${values.zone}-${String(Date.now())}`));

async function bench() {
  mkdirSync(out, { recursive: true });
  /** @type {any[]} */
  const report = [];
  const phone = values.driver === 'inspector';
  const tools = phone ? await phoneTools() : null;
  const environment = { zone: values.zone, base, driver: values.driver, runs, caps, slots, startedAt: new Date().toISOString(),
    routeName: route, route: routeFor(route), phone: tools?.facts ?? null, idleCelsius: tools?.idle ?? null };
  writeFileSync(join(out, 'environment.json'), JSON.stringify(environment, null, 2));
  try {
    // --ab <slot>: each run plays the slot off and on, in alternating order (ABBA), so the pairs share one idle reading
    const sides = values.ab === undefined ? [null] : [false, true];
    const trials = Array.from({ length: runs }, (_, i) => (i % 2 === 0 ? sides : [...sides].reverse())
      .flatMap((ab) => (i % 2 === 0 ? caps : [...caps].reverse()).map((cap) => ({ run: i + 1, cap, ab })))).flat();
    for (const { run, cap, ab } of trials) {
      const trialSlots = ab === null || values.ab === undefined ? slots : { ...slots, [values.ab]: ab };
      const temperature = tools === null ? null : await tools.cool();
      const { webkitDriver, driver } = phone ? { webkitDriver: null, driver: await /** @type {NonNullable<typeof tools>} */ (tools).fresh() }
        : await (async () => { const { startWebKit } = await import('./webkit.mjs'); const started = await startWebKit(); return { webkitDriver: started, driver: started }; })();
      const directory = join(out, `run-${String(run)}-cap${String(cap)}${ab === null ? '' : `-${String(ab)}`}`);
      mkdirSync(directory, { recursive: true });
      /** @type {Promise<void> | null} */
      let profiling = null;
      /** @type {any} */
      const row = { run, cap, ab, temperature, boot: null, legs: [], error: null, screenshot: null };
      try {
        tools?.lockState(`run ${String(run)} cap ${String(cap)} before boot`);
        // --cache-off (DF8): Safari's resource cache off for the boot, a first load of a new build (link-bench's cold runs)
        const boot = await enterZone(/** @type {any} */ (driver), { base, slug: values.zone, slots: trialSlots, cacheOff: values['cache-off'] === true });
        row.boot = { outcome: boot.outcome, controlS: boot.controlAt !== null && boot.startedAt !== null ? (boot.controlAt - boot.startedAt) / 1000 : null,
          build: boot.state?.build ?? null, version: boot.state?.version ?? null, error: boot.state?.error ?? null };
        tools?.lockState(`run ${String(run)} cap ${String(cap)} after boot`);
        console.log(`run ${String(run)} cap ${String(cap)}${ab === null ? '' : ` ${String(values.ab)}=${String(ab)}`}: ${boot.outcome} in ${String(row.boot.controlS)} s (${String(row.boot.version)})`);
        if (boot.outcome === 'control') {
          if ('gesture' in driver && typeof driver.gesture === 'function') await driver.gesture(askWake).catch(() => undefined);
          row.wakeLock = await driver.evaluateAsync(holdWake, [], 10_000).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          console.log(`  wake lock: ${String(row.wakeLock)}`);
          if (values.frames === true) row.frameLog = await driver.evaluate(FRAME_LOG_START).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (values.frames === true && 'heapStart' in driver && typeof driver.heapStart === 'function') row.heapLog = await driver.heapStart().then(() => 'logging', (/** @type {unknown} */ error) => `error: ${String(error)}`);
          if (values.voices === true) row.voiceLog = await driver.evaluate(VOICE_LOG_START).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          if ('gesture' in driver && typeof driver.gesture === 'function') row.audioUnlock = await driver.gesture(unlockAudio).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
          // --profile <s>: WebKit's sampling profiler over the route's first seconds (DW2: what the long tasks are)
          if (values.profile !== undefined && 'profileStart' in driver && typeof driver.profileStart === 'function') {
            const profiled = driver;
            // --profile-delay <s>: start the sampler that long after the route starts, to reach a later leg (a long
            // sample overflows the inspector socket: 8 s with the top-up off closed it three times, 3 s did not)
            const delay = Number(values['profile-delay'] ?? 0) * 1000;
            if (delay === 0) await profiled.profileStart();
            profiling = (async () => {
              try {
                if (delay > 0) { await pause(delay); await profiled.profileStart(); }
                await pause(Number(values.profile) * 1000);
                const samples = await profiled.profileStop();
                writeFileSync(join(directory, 'profile.json'), JSON.stringify(samples));
                console.log(`  profile: ${String(samples.length)} samples in ${join(directory, 'profile.json')}`);
              } catch (error) { console.log(`  profile: ${String(error)}`); }
            })();
          }
          if ('quiet' in driver && typeof driver.quiet === 'function') await driver.quiet();
          row.legs = await playRoute(driver, { slug: route, cap, rec: values.rec ?? [], legs: values.legs === undefined ? undefined : Number(values.legs), log: (line) => { console.log(`  ${String(cap)} ${line}`); } });
          if (values.voices === true) {
            try {
              const log = /** @type {[string, number, number, number, number][] | null} */ (await driver.evaluate(VOICE_LOG_READ));
              row.voices = log;
              const byFamily = new Map();
              for (const render of log ?? []) { const family = render[0], ms = render[4], f = byFamily.get(family) ?? [0, 0, 0]; f[0]++; f[1] += ms; f[2] = Math.max(f[2], ms); byFamily.set(family, f); }
              for (const [family, [count, ms, worst]] of [...byFamily].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12)) console.log(`  voices ${family}: ${String(count)} renders, ${ms.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
              row.voiceWorker = await driver.evaluate(VOICE_WORKER_READ).catch((/** @type {unknown} */ error) => `error: ${String(error)}`);
              console.log(`  voice worker: ${JSON.stringify(row.voiceWorker)}; page-thread renders over 30 ms: ${String((log ?? []).filter((render) => render[4] > 30).length)}`);
            } catch (error) { row.voicesError = String(error); }
          }
          if (values.frames === true) {
            try {
              const log = await driver.evaluate(FRAME_LOG_READ);
              row.frames = log;
              const long = (log?.frames ?? []).filter((/** @type {any[]} */ f) => f[1] > 50);
              console.log(`  frames: ${String(log?.count ?? 0)} logged, ${String(long.length)} over 50 ms, ${String(long.filter((/** @type {any[]} */ f) => f[2] > 0 || f[4] > 65536 || f[5] > 65536).length)} of them with links or big uploads, ${String(log?.adds?.length ?? 0)} scene adds`);
              // DF8: each update over 50 ms with the game's own split (FRAME_LOG_START's costs)
              for (const c of (log?.costs ?? []).filter((/** @type {any[]} */ cost) => cost[1] > 50)) {
                console.log(`  update ${String(c[1])} ms at ${String(Math.round((c[0] - (log?.from ?? 0)) / 100) / 10)} s: top ${String(c[3])}; ${String(c[4])}`);
              }
              // DF8 (mini-driftwood13h): each frame over 50 ms named (gc, compile, upload, update, render, other)
              if (row.heapLog === 'logging' && 'heapStop' in driver && typeof driver.heapStop === 'function') {
                row.gc = await driver.heapStop().catch((/** @type {unknown} */ error) => ({ error: String(error), collections: [] }));
                const gcs = /** @type {[string, number, number][]} */ (row.gc?.collections ?? []);
                console.log(`  gc: ${String(gcs.length)} collections (${String(gcs.filter((c) => c[0] === 'full').length)} full), ${String(gcs.filter((c) => c[2] - c[1] >= 10).length)} of 10 ms or more, anchor ±${String((row.gc?.anchorMs ?? 0) / 2)} ms`);
              }
              const named = nameLongFrames(log?.frames ?? [], row.gc?.collections ?? []);
              row.named = named;
              /** @type {Record<string, number>} */
              const byCause = {};
              // mini-driftwood13m: with `debug.taskStamp` on, an `other` frame says whether a callback, unwrapped work or nothing held the main thread
              for (const n of named) { const kind = n.cause === 'other' ? otherKind(n, log ?? {}) : null; if (kind !== null) { n.causes.push(kind); n.cause = `other ${kind.split(' ')[0] ?? ''}`; } byCause[n.cause] = (byCause[n.cause] ?? 0) + 1; }
              console.log(`  long frames by cause: ${JSON.stringify(byCause)}`);
              const gaps = gapWork(named, log ?? {});
              row.gaps = gaps;
              named.forEach((n, i) => { const gap = gaps[i] ?? [];
                console.log(`  long ${String(Math.round(n.ms))} ms at ${String(Math.round((n.at - (log?.from ?? 0)) / 100) / 10)} s: ${n.causes.join('; ') || 'other'}${gap.length === 0 ? '' : ` | ${gap.join(' | ')}`}`); });
              // mini-driftwood13i: the systems that ran over 15 ms at least once: runs, total ms, runs over 5 / 15 ms, longest
              for (const [id, n, sum, over5, over15, max] of log?.sys ?? []) console.log(`  system ${String(id)}: ${String(n)} runs, ${String(sum)} ms, >5 ${String(over5)}, >15 ${String(over15)}, max ${String(max)}`);

            } catch (error) { row.framesError = String(error); }
          }
          if (values.census === true) {
            try {
              row.census = await /** @type {any} */ (driver).evaluateAsync(OWNER_CENSUS, [10], 30_000);
              console.log(`  census quality: ${JSON.stringify(row.census?.quality ?? null)}`);
              console.log(`  census vertex pack: ${JSON.stringify(row.census?.pack ?? null)}`);
              for (const [owner, draws, triangles] of row.census?.owners?.slice(0, 12) ?? []) console.log(`  census ${String(triangles).padStart(8)} ${String(draws).padStart(5)}  ${String(owner)}`);
            } catch (error) { row.censusError = String(error); console.log(`  census: ${row.censusError}`); }
          }
        }
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); console.log(`run ${String(run)}: ${row.error}`); }
      await profiling;
      if (String(row.error).startsWith('PHONE LOCKED')) { report.push(row); writeFileSync(join(out, 'route.json'), JSON.stringify(report, null, 2)); throw new Error(row.error); }
      try {
        const shot = join(directory, phone ? 'end.png' : 'end.jpg');
        await (phone ? /** @type {NonNullable<typeof tools>} */ (tools).screenshot(shot) : /** @type {any} */ (driver).screenshot(shot));
        row.screenshot = shot;
      } catch (error) { row.screenshotError = String(error); }
      await (webkitDriver === null ? /** @type {any} */ (driver).close?.().catch(() => undefined) : webkitDriver.stop());
      report.push(row);
      writeFileSync(join(out, 'route.json'), JSON.stringify(report, null, 2));
    }
  } finally { await tools?.stop(); }
  const lines = [`# ${values.zone} route bench`, '', `${values.driver} · ${base} · ${String(runs)} runs · caps ${caps.join(', ')} · ${environment.startedAt}`, ''];
  for (const row of report) {
    lines.push(`## Run ${String(row.run)}, cap ${String(row.cap)}${row.ab === null ? '' : `, ${String(values.ab)} ${String(row.ab)}`}: ${String(row.boot?.outcome ?? row.error)}${row.boot?.controlS ? `, control ${row.boot.controlS.toFixed(1)} s` : ''}${row.temperature === null ? '' : `, ${String(row.temperature)} °C`}`, '');
    lines.push(routeTable(row.legs), '');
    for (const leg of row.legs) if (typeof leg.rec === 'string') lines.push(`### REC 30 S: ${String(leg.name)}`, '', '```text', leg.rec, '```', '');
  }
  for (const cap of caps) {
    const ranked = worstSegment(report, cap);
    lines.push(`## Worst segments at cap ${String(cap)} (median over runs)`, '', '| Segment | p95 ms | >50 ms per 30 s | fps | runs |', '|---|---|---|---|---|',
      ...ranked.slice(0, 5).map((row) => `| ${row.name} | ${String(row.p95Ms)} | ${String(row.over50Per30s)} | ${String(row.fps)} | ${String(row.runs)} |`), '');
  }
  writeFileSync(join(out, 'route.md'), lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`route bench: ${join(out, 'route.md')}`);
}

/** The phone's side: doctor, idle temperature, a fresh Safari per run through devicectl, screenshots through devicectl. */
async function phoneTools() {
  const { batteryTemperature, command, doctor } = await import('./doctor.mjs');
  const { startInspector } = await import('./inspector.mjs');
  const { takeScreenshot } = await import('./record.mjs');
  const facts = doctor({ udid: values.udid, sharedPort: '4444' });
  const reading = () => batteryTemperature(command('idevicediagnostics', ['-u', facts.udid, 'ioregentry', 'AppleSmartBattery']).output)?.celsius ?? null;
  const launchUrl = new URL('/robots.txt', base).href;
  // the coordinator, 2026-11-19: the phone locked at 16:01-16:08 with Auto-Lock off and no lock command from us; every
  // proxy start and stop and every devicectl launch logs lockState before and after, and a locked phone stops the bench
  const lockLog = resolve(values['lock-log']);
  mkdirSync(dirname(lockLog), { recursive: true });
  const lockState = (/** @type {string} */ label) => {
    const done = command('xcrun', ['devicectl', 'device', 'info', 'lockState', '--device', facts.udid]);
    const passcode = /passcodeRequired:\s*(\w+)/u.exec(done.output)?.[1] ?? 'unread';
    const since = /unlockedSinceBoot:\s*(\w+)/u.exec(done.output)?.[1] ?? '?';
    appendFileSync(lockLog, `${new Date().toISOString()} ${label} passcodeRequired=${passcode} unlockedSinceBoot=${since}\n`);
    if (passcode === 'true') throw new Error(`PHONE LOCKED at ${label} (lockState in ${lockLog}): stop touching the phone`);
  };
  lockState('before proxy start');
  const inspector = await startInspector(facts.udid, { launchUrl });
  lockState('after proxy start');
  const idle = reading();
  return {
    facts: { ...facts, udid: undefined }, idle,
    async fresh() {
      lockState('before devicectl launch');
      const driver = await inspector.fresh();
      lockState('after devicectl launch');
      return driver;
    },
    lockState,
    /** Wait (at most 10 min) for the battery to come back within 3 °C of the first reading, or to --cool-to °C. */
    async cool() {
      const deadline = Date.now() + 10 * 60_000;
      let now = reading();
      const line = values['cool-to'] === undefined ? (idle === null ? null : idle + 3) : Number(values['cool-to']);
      if (line === null) return now;
      while (now !== null && now > line && Date.now() < deadline) {
        console.log(`cooling: ${String(now)} °C against ${String(line)} °C`);
        await pause(15_000);
        now = reading();
      }
      return now;
    },
    screenshot: (/** @type {string} */ file) => takeScreenshot(facts.udid, file),
    async stop() {
      lockState('before proxy stop');
      await inspector.stop();
      lockState('after proxy stop');
    },
  };
}

if (values['dry-run']) {
  console.log(JSON.stringify({ zone: values.zone, runs, caps, base, driver: values.driver, slots, out, route, legs: routeFor(route).map((leg) => `${leg.name} (${leg.kind} ${String(leg.seconds)} s)`) }, null, 2));
} else if (!values['with-locks']) {
  // the phone holds iphone13.lock then mini-measure.lock; the desktop proxy measures on the Mac, so mini-measure.lock only
  const root = join(homedir(), 'projects/games/wildshard/engine/tmp');
  mkdirSync(root, { recursive: true });
  const locks = values.driver === 'inspector' ? ['-k', join(root, 'iphone13.lock'), '/usr/bin/lockf', '-k', join(root, 'mini-measure.lock')] : ['-k', join(root, 'mini-measure.lock')];
  console.log(`Waiting for ${values.driver === 'inspector' ? 'iphone13.lock, then ' : ''}mini-measure.lock`);
  const child = spawn('/usr/bin/lockf', [...locks, process.execPath, import.meta.filename, ...process.argv.slice(2), '--out', out, '--with-locks'], { stdio: 'inherit' });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} else {
  await bench();
}
