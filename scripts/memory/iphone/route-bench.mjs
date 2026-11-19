#!/usr/bin/env node
// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13, 2026-11-19): one command runs a zone's route bench cold and writes a table.
//
//   node scripts/memory/iphone/route-bench.mjs [--zone driftwood-isle] [--runs 3] [--caps 30,60] [--base <origin>]
//     [--driver inspector|webkit] [--slots key=value ...] [--out <dir>] [--dry-run]
//
// Each run is a cold boot (fresh Safari on the phone, a fresh WebKit on the Mac; origin storage cleared, phone Low seeded)
// to control, then the route (route.mjs) once per cap, alternating which cap goes first run to run. The phone runs under
// iphone13.lock then mini-measure.lock, with no WebDriver session: devicectl opens Safari and Web Inspector drives it
// (inspector.mjs). `--driver webkit` is the desktop proxy (headless WebKit as an iPhone 13) under mini-measure.lock.
// Output: <out>/route.json (every leg's samples) and <out>/route.md (one row per run, cap and segment, then the worst).
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { deviceSavePicks } from '../../debug-settings.mjs';
import { enterZone } from './safari.mjs';
import { playRoute, routeFor, routeTable, worstSegment } from './route.mjs';

const { values } = parseArgs({ options: {
  zone: { type: 'string', default: 'driftwood-isle' }, runs: { type: 'string', default: '3' }, caps: { type: 'string', default: '30,60' },
  base: { type: 'string', default: 'https://staging.wildshard.io/' }, driver: { type: 'string', default: 'inspector' },
  slots: { type: 'string', multiple: true }, out: { type: 'string' }, udid: { type: 'string' },
  'dry-run': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
} });
const runs = Number(values.runs), caps = /** @type {(30|60)[]} */ (values.caps.split(',').map(Number));
if (!Number.isSafeInteger(runs) || runs < 1 || caps.length === 0 || caps.some((cap) => cap !== 30 && cap !== 60)) throw new Error('--runs is a positive integer, --caps a list of 30 and 60');
if (!['inspector', 'webkit'].includes(values.driver)) throw new Error('--driver is inspector (the iPhone) or webkit (the desktop proxy)');
routeFor(values.zone);
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
    route: routeFor(values.zone), phone: tools?.facts ?? null, idleCelsius: tools?.idle ?? null };
  writeFileSync(join(out, 'environment.json'), JSON.stringify(environment, null, 2));
  try {
    for (let run = 1; run <= runs; run++) {
      const order = run % 2 === 1 ? caps : [...caps].reverse();
      const temperature = tools === null ? null : await tools.cool();
      const { webkitDriver, driver } = phone ? { webkitDriver: null, driver: await /** @type {NonNullable<typeof tools>} */ (tools).fresh() }
        : await (async () => { const { startWebKit } = await import('./webkit.mjs'); const started = await startWebKit(); return { webkitDriver: started, driver: started }; })();
      const directory = join(out, `run-${String(run)}`);
      mkdirSync(directory, { recursive: true });
      /** @type {any} */
      const row = { run, temperature, order, boot: null, legs: [], error: null, screenshot: null };
      try {
        const boot = await enterZone(/** @type {any} */ (driver), { base, slug: values.zone, slots });
        row.boot = { outcome: boot.outcome, controlS: boot.controlAt !== null && boot.startedAt !== null ? (boot.controlAt - boot.startedAt) / 1000 : null,
          build: boot.state?.build ?? null, version: boot.state?.version ?? null, error: boot.state?.error ?? null };
        console.log(`run ${String(run)}: ${boot.outcome} in ${String(row.boot.controlS)} s (${String(row.boot.version)})`);
        if (boot.outcome === 'control') {
          if ('quiet' in driver && typeof driver.quiet === 'function') await driver.quiet();
          for (const cap of order) {
            const legs = await playRoute(driver, { slug: values.zone, cap, log: (line) => { console.log(`  ${String(cap)} ${line}`); } });
            row.legs.push(...legs);
            if (legs.some((leg) => leg.error === 'the page lost the controlled world during the leg')) break;
          }
        }
      } catch (error) { row.error = error instanceof Error ? error.message : String(error); console.log(`run ${String(run)}: ${row.error}`); }
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
    lines.push(`## Run ${String(row.run)}: ${String(row.boot?.outcome ?? row.error)}${row.boot?.controlS ? `, control ${row.boot.controlS.toFixed(1)} s` : ''}${row.temperature === null ? '' : `, ${String(row.temperature)} °C`}`, '');
    lines.push(routeTable(row.legs), '');
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
  const inspector = await startInspector(facts.udid, { launchUrl });
  const idle = reading();
  return {
    facts: { ...facts, udid: undefined }, idle,
    fresh: () => inspector.fresh(),
    /** Wait (at most 10 min) for the battery to come back within 3 °C of the first reading. */
    async cool() {
      const deadline = Date.now() + 10 * 60_000;
      let now = reading();
      if (idle === null) return now;
      while (now !== null && now - idle > 3 && Date.now() < deadline) {
        console.log(`cooling: ${String(now)} °C against ${String(idle)} °C`);
        await pause(15_000);
        now = reading();
      }
      return now;
    },
    screenshot: (/** @type {string} */ file) => takeScreenshot(facts.udid, file),
    stop: () => inspector.stop(),
  };
}

if (values['dry-run']) {
  console.log(JSON.stringify({ zone: values.zone, runs, caps, base, driver: values.driver, slots, out, legs: routeFor(values.zone).map((leg) => `${leg.name} (${leg.kind} ${String(leg.seconds)} s)`) }, null, 2));
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
