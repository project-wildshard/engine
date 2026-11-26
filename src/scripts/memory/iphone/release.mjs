#!/usr/bin/env node
// IP26: this suite records phone measurements for comparison after staging releases.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { median } from '../calibration.mjs';
import { DRIFTWOOD, DRIFTWOOD_CAPS, driftwoodTable, readDriftwood } from './release-driftwood.mjs';

const STAGING = 'https://staging.wildshard.io/';
const HISTORY = 'docs/plans/MULTI-REPO-SAGA/MEMORY-SAGA/iphone13/history.jsonl';
const TASKS = /** @type {const} */ ([
  { key: 'brasscap', zone: 'brasscap-mesa', mode: 'boot', runs: 3 },
  { key: 'nine', zone: 'nine-dragon-stack', mode: 'boot', runs: 3 },
  { key: 'walk', zone: 'nine-dragon-stack', mode: 'walk', runs: 1 },
]);
const METRICS = /** @type {const} */ ([
  ['webPeak', 'WebContent peak', 'MB'], ['webSettled', 'WebContent settled', 'MB'],
  ['gpuPeak', 'GPU peak', 'MB'], ['gpuSettled', 'GPU settled', 'MB'],
  ['controlMs', 'Time to control', 's'], ['fps', 'Frame rate', 'fps'],
]);

/** @typedef {{peakBytes?: number | null, settledBytes?: number | null}} Footprint */
/** @typedef {{build?: string | null, phases?: {su?: {fact?: string | null, pct?: string | null}}}} PageState */
/** @typedef {{zoneSlug?:string|null, fault?:string|null, measurements?: Readonly<Record<string, Footprint>>, zone?: {
 * openedAt?: number, last?: PageState, error?: {message: string, code?: string | null} | null,
 * boot?: {outcome: string, startedAt?: number | null, controlAt?: number | null, reloaded?: boolean, state?: PageState},
 * frames?: {samples?: readonly {seconds: number}[], summary?: {fps?: number | null}}
 * }}} Trial */
/** @typedef {(typeof METRICS)[number][0]} Metric */
/** @typedef {ReturnType<typeof observedAttempt>} Attempt */
/** @typedef {{status: string, attempts: number, control: number, metrics: Record<Metric, number | null>, observations?: Attempt[]}} Stage */
/** @typedef {{date: string, source: 'phone' | 'recorded', base: string, build: string | null, builds: string[],
 * stages: Record<(typeof TASKS)[number]['key'], Stage>, driftwood?: ReturnType<typeof readDriftwood>}} HistoryRow */

/** @param {string} directory @returns {Trial[]} */
function readTrials(directory) {
  try {
    const value = /** @type {Trial[]} */ (JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8')));
    if (!Array.isArray(value)) throw new Error(`Expected bench trial array in ${directory}`);
    return value;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
}

/** @param {readonly (number | null | undefined)[]} values @param {number} runs */
function completeMedian(values, runs) {
  const samples = values.flatMap(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? [value] : []);
  return samples.length === runs && values.length === runs ? median(samples) : null;
}

/** @param {Trial} row */
const pageBuild = row => row.zone?.boot?.state?.build ?? row.zone?.last?.build ?? null;

/** Older bench recordings did not tag their zone. Their task folder is the only source.
 * @param {Trial} row @param {string} slug */
const matchesZone = (row, slug) => row.zoneSlug === undefined || row.zoneSlug === slug;

/** @param {Trial} row @param {string} expected */
function observedAttempt(row, expected) {
  const { zone } = row, step = zone?.last?.phases?.su ?? zone?.boot?.state?.phases?.su;
  const start = zone?.boot?.startedAt, end = zone?.boot?.controlAt;
  const controlMs = typeof start === 'number' && typeof end === 'number' && Number.isFinite(end - start) && end >= start ? end - start : null;
  const outcome = zone?.error?.code ?? (zone?.error || row.fault ? 'capture error' : zone?.boot?.outcome ?? 'unavailable');
  const excluded = !matchesZone(row, expected) ? `expected ${expected}`
    : zone?.boot?.reloaded === true ? 'boot reloaded during capture' : null;
  return { zone: row.zoneSlug ?? expected, build: pageBuild(row), outcome, controlMs,
    stage: step?.fact ?? null, progress: step?.pct ?? null, excluded };
}

/** @param {readonly Trial[]} trials @param {(typeof TASKS)[number]} task @param {string|null} build */
function stageOf(trials, task, build) {
  const attempts = trials.map(row => ({ row, observation: observedAttempt(row, task.zone) }));
  const played = attempts.filter(({ row, observation }) =>
    observation.excluded === null && row.zone?.boot?.outcome === 'control' && !row.zone.error && !row.fault);
  const readings = played.filter(({ observation }) => build !== null && observation.build === build).map(({ row: { measurements, zone }, observation }) => {
    const web = measurements?.['com.apple.WebKit.WebContent'], gpu = measurements?.['com.apple.WebKit.GPU'];
    const seconds = zone?.frames?.samples?.reduce((sum, sample) => sum + sample.seconds, 0) ?? 0;
    return {
      webPeak: web?.peakBytes, webSettled: web?.settledBytes, gpuPeak: gpu?.peakBytes, gpuSettled: gpu?.settledBytes,
      controlMs: observation.controlMs,
      fps: task.mode === 'walk' && Math.round(seconds * 1000) >= 60_000 ? zone?.frames?.summary?.fps : null,
    };
  });
  const metrics = /** @type {Stage['metrics']} */ (Object.fromEntries(METRICS.map(([key]) =>
    [key, completeMedian(readings.map(row => row[key]), task.runs)])));
  const complete = trials.length === task.runs && METRICS.every(([key]) =>
    (key === 'fps' && task.mode !== 'walk') || metrics[key] !== null);
  return { status: complete ? 'complete' : 'incomplete', attempts: trials.length, control: played.length, metrics,
    observations: attempts.map(({ observation }) => observation) };
}

/** @param {string} directory @param {{date: string, source: HistoryRow['source'], base: string}} info */
export function releaseReading(directory, info) {
  const results = TASKS.map(task => ({ task, trials: readTrials(join(directory, task.key)) }));
  const builds = [...new Set(results.flatMap(({ task, trials }) => trials.flatMap(row => {
    const build = pageBuild(row);
    return matchesZone(row, task.zone) && build !== null && build.trim() !== '' ? [build] : [];
  })))];
  const build = builds.length === 1 ? builds[0] : null;
  const stages = /** @type {HistoryRow['stages']} */ (Object.fromEntries(results.map(({ task, trials }) =>
    [task.key, stageOf(trials, task, build)])));
  return { ...info, build, builds, stages, driftwood: readDriftwood(join(directory, 'driftwood'), builds) };
}

/** @param {number|null} previous @param {number|null} current */
export function memoryChange(previous, current) {
  if (previous === null || current === null) return 'unavailable';
  const delta = current - previous;
  if (Math.abs(delta) <= Math.max(previous * 0.02, 5_000_000)) return 'within noise';
  return delta > 0 ? 'higher' : 'lower';
}

/** @param {number|null} value @param {string} unit */
function readingText(value, unit) {
  if (value === null) return '—';
  const scale = unit === 'MB' ? 1e6 : unit === 's' ? 1e3 : 1;
  return `${(value / scale).toFixed(2)} ${unit}`;
}

/** @param {HistoryRow} reading @param {HistoryRow | null} previous */
export function releaseTable(reading, previous) {
  const lines = [`iPhone staging release report (report only). Build ${reading.build ?? 'unconfirmed'}.`];
  if (reading.builds.length > 1) lines.push('Several page builds were observed. Measurements are unavailable for this suite.');
  if (previous !== null) lines.push(`Previous build ${previous.build ?? 'unconfirmed'}.`);
  lines.push('| Suite | Reading | Current | Change | Verdict |', '|---|---|---:|---:|---|');
  for (const task of TASKS) {
    const stage = reading.stages[task.key];
    const before = previous?.stages[task.key];
    lines.push(`| ${task.key} | ${stage.status}, ${stage.control}/${task.runs} at control | | | |`);
    for (const [key, label, unit] of METRICS) {
      if (key === 'fps' && task.mode !== 'walk') continue;
      const current = stage.metrics[key], old = before?.metrics[key] ?? null;
      const change = old === null || current === null ? null : current - old;
      const verdict = current === null ? 'unavailable'
        : previous === null ? 'first report'
        : unit === 'MB' ? memoryChange(old, current)
        : change === null ? 'unavailable' : 'reported';
      lines.push(`| ${task.key} | ${label} | ${readingText(current, unit)} | ${change !== null && change > 0 ? '+' : ''}${readingText(change, unit)} | ${verdict} |`);
    }
  }
  const observations = TASKS.flatMap(({ key }) => (reading.stages[key].observations ?? []).map((attempt, index) => {
    const detail = [attempt.progress, attempt.stage, attempt.excluded === null ? null : `excluded (${attempt.excluded})`]
      .filter(part => part !== null).join(' · ');
    const time = attempt.controlMs === null ? '' : ` in ${readingText(attempt.controlMs, 's')}`;
    return `- ${key} ${index + 1}, ${attempt.zone}, build ${attempt.build ?? 'unconfirmed'} · ${attempt.outcome}${time}${detail === '' ? '' : ` · ${detail}`}`;
  }));
  if (observations.length > 0) lines.push('', 'Captured attempts', ...observations);
  if (reading.driftwood !== undefined) lines.push(...driftwoodTable(reading.driftwood, previous?.driftwood));
  return lines.join('\n');
}

/** @param {string} path @returns {HistoryRow | null} */
function previousRow(path) {
  try {
    const last = readFileSync(path, 'utf8').trim().split('\n').at(-1);
    return last ? /** @type {HistoryRow} */ (JSON.parse(last)) : null;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
}

/** @param {string} script @param {readonly string[]} args */
function runBench(script, args) {
  // Release samples use fresh sessions. The outer suite already holds iphone13.lock.
  const env = { ...process.env };
  delete env.WD_SESSION;
  return new Promise((_resolve) => {
    const child = spawn(process.execPath, [script, ...args, '--with-locks'], { env, stdio: 'inherit' });
    child.once('error', () => { _resolve(null); });
    child.once('close', code => { _resolve(code); });
  });
}

/** @param {string[]} args @param {{script: string, lock: (script: string, args: string[]) => Promise<number>}} [bench] */
export async function releaseSuite(args, bench) {
  const { values } = parseArgs({ args, options: {
    base: { type: 'string', default: STAGING }, out: { type: 'string' }, history: { type: 'string' },
    recorded: { type: 'string' }, udid: { type: 'string' }, webdriver: { type: 'string' },
    trace: { type: 'string' }, 'idle-celsius': { type: 'string' },
    'dry-run': { type: 'boolean' }, 'with-locks': { type: 'boolean' },
  } });
  const base = new URL(values.base).href;
  const out = resolve(values.recorded ?? values.out ?? join('tmp/iphone13', `release-${Date.now()}`));
  if (values.recorded !== undefined && values.history === undefined && !values['dry-run']) {
    throw new Error('Recorded replay needs an explicit scratch --history path');
  }
  const liveHistory = join(homedir(), 'projects/games/project-wildshard-meta', HISTORY);
  const history = resolve(values.history ?? liveHistory);
  if (values.recorded !== undefined && values.history !== undefined && history === liveHistory && !values['dry-run']) {
    throw new Error('Recorded replay cannot append to the live iPhone history');
  }
  const pass = Object.entries({ udid: values.udid, webdriver: values.webdriver,
    trace: values.trace, 'idle-celsius': values['idle-celsius'] })
    .flatMap(([key, value]) => value === undefined ? [] : [`--${key}`, value]);
  const commands = TASKS.map(task => ['--base', base, '--zone', task.zone, '--mode', task.mode, '--runs',
    String(task.runs), '--out', join(out, task.key)].concat(pass));
  const routeScript = join(import.meta.dirname, 'route-bench.mjs');
  const routeOut = join(out, 'driftwood');
  const routeCommand = ['--base', base, '--zone', DRIFTWOOD, '--driver', 'inspector', '--runs', '3',
    '--caps', DRIFTWOOD_CAPS.join(','), '--out', routeOut, '--lock-log', join(routeOut, 'lockstate.log')];
  if (values.udid !== undefined) routeCommand.push('--udid', values.udid);
  if (values.recorded === undefined) {
    if (values['dry-run']) {
      console.log('Report only. Hold iphone13.lock for all captures.');
      for (const command of commands) console.log(JSON.stringify(command));
      console.log(JSON.stringify([routeScript, ...routeCommand]));
      console.log(`History: ${history}`);
      return 0;
    }
    if (bench === undefined) throw new Error('Live release capture needs the M1 bench: bench.mjs --suite release');
    if (!values['with-locks']) {
      // Carry the same output directory through the locked invocation.
      return bench.lock(bench.script, ['--suite', 'release', ...args, '--out', out, '--with-locks']);
    }
    // Every live report owns a fresh directory. A refused or interrupted child
    // cannot contribute a report left by a previous capture.
    mkdirSync(dirname(out), { recursive: true });
    mkdirSync(out);
    for (const command of commands) {
      const status = await runBench(bench.script, command);
      if (status !== 0) console.log(`Bench ended with ${String(status)} for ${command[3]} ${command[5]}. Keeping its available report.`);
    }
    const routeStatus = await runBench(routeScript, routeCommand);
    if (routeStatus !== 0) console.log(`Driftwood route bench ended with ${String(routeStatus)}. Keeping its available report.`);
  }
  const reading = releaseReading(out, { date: new Date().toISOString(), source: values.recorded === undefined ? 'phone' : 'recorded', base });
  const last = previousRow(history);
  console.log(releaseTable(reading, last?.source === reading.source && last.base === reading.base ? last : null));
  if (!values['dry-run']) {
    mkdirSync(dirname(history), { recursive: true });
    appendFileSync(history, `${JSON.stringify(reading)}\n`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await releaseSuite(process.argv.slice(2));
