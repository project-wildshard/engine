// EM35–EM36. Byte budgets for ledger capacity and native WebContent footprint have separate baselines.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { memorySubsystems, PHONE_MEMORY_BUDGETS } from '../../src/shared/engine/core/memoryBudget.ts';

const SUBSYSTEMS = Object.keys(PHONE_MEMORY_BUDGETS);
const LEDGER_PHASES = ['control', 'peak'];

/** @typedef {import('../../src/shared/engine/core/memoryBudget.ts').BudgetLedger} BudgetLedger */
/** @typedef {{step:string, ledger:BudgetLedger | null}} Reading */
/** @typedef {{control: Record<string,number>, peak: Record<string,number>}} LedgerBudget */
/** @typedef {{settled: number, spread: number}} FootprintBudget */

function byteCount(/** @type {unknown} */ value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Expected a nonnegative byte count');
  return value;
}

function capacity(/** @type {BudgetLedger} */ reading) {
  const totals = memorySubsystems(reading);
  return Object.fromEntries(Object.entries(totals).map(([kind, { gpu, ram }]) => [kind, gpu + ram]));
}

/** Latest control and the maximum observed bytes of each subsystem before that checkpoint.
 * @param {readonly Reading[]} checkpoints @returns {LedgerBudget} */
export function ledgerBudget(checkpoints) {
  const last = checkpoints.findLastIndex(row => row.step === 'control');
  const control = last === -1 ? null : checkpoints[last]?.ledger;
  if (!control) throw new Error('Boot did not record a control ledger');
  const peak = capacity(control);
  for (const { ledger } of checkpoints.slice(0, last)) {
    if (ledger === null) continue;
    for (const [kind, bytes] of Object.entries(capacity(ledger))) peak[kind] = Math.max(peak[kind], bytes);
  }
  return { control: capacity(control), peak };
}

/**
 * Check every boot and ratchet to the largest observation in the same batch,
 * bounded by the previous baseline. A new budget requires a measured baseline.
 * @param {LedgerBudget} baseline @param {readonly LedgerBudget[]} runs
 * @param {string} zone @returns {LedgerBudget}
 */
export function compareLedger(baseline, runs, zone) {
  if (runs.length === 0) throw new Error(`${zone}: no successful ledger boots`);
  /** @type {LedgerBudget} */
  const next = { control: {}, peak: {} };
  const failures = [];
  for (const phase of LEDGER_PHASES) for (const kind of SUBSYSTEMS) {
    const previous = byteCount(baseline[phase]?.[kind]);
    const observed = Math.max(...runs.map(run => byteCount(run[phase]?.[kind])));
    const limit = previous + Math.floor(previous * 0.02);
    if (observed > limit) failures.push(`${zone} ${phase} ${kind}: ${observed} B > ${limit} B (baseline ${previous} B)`);
    next[phase][kind] = Math.min(previous, observed);
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return next;
}

/**
 * A hosted Chromium boot is one sample: control "loading" swings by 3–4 MB
 * with how many ring tiles happen to be resident, so a single over-line
 * reading is retried (memory/ci.mjs) and the zone fails only when every
 * reading is over. A retained allocation shows in every boot and still fails.
 * @param {LedgerBudget} baseline @param {readonly LedgerBudget[]} runs
 * @param {string} zone @returns {LedgerBudget}
 */
export function confirmLedger(baseline, runs, zone) {
  if (runs.length === 0) throw new Error(`${zone}: no successful ledger boots`);
  const failures = [];
  for (const run of runs) {
    const failure = ledgerOverLine(baseline, run, zone);
    if (failure === null) return compareLedger(baseline, [run], zone);
    failures.push(failure);
  }
  throw new Error(`${zone}: ${runs.length} of ${runs.length} readings over the line\n${failures.join('\n')}`);
}

/** The failure a single reading would raise, or null when it is inside the line.
 * @param {LedgerBudget} baseline @param {LedgerBudget} run @param {string} zone @returns {string | null} */
export function ledgerOverLine(baseline, run, zone) {
  try { compareLedger(baseline, [run], zone); return null; } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Read one hosted zone for the comparison guard. A boot that is over the line,
 * or that never reaches control (hosted SwiftShader blocks the page for many
 * seconds at a time), is booted once more; the files returned go to
 * confirmLedger. With no baseline for the zone the first failure stands.
 * @param {{ zone: string, baseline: LedgerBudget | undefined, boot: (round: number) => Promise<string>,
 *   read: (file: string) => any, log: (line: string) => void }} ports
 * @returns {Promise<string[]>}
 */
export async function confirmZone({ zone, baseline, boot, read, log }) {
  let first;
  try { first = await boot(1); } catch (error) {
    if (baseline === undefined) throw error;
    log(`${zone}: ${error instanceof Error ? error.message : String(error)}\nBooting ${zone} once more: it fails only if this boot fails too.`);
    return [await boot(2)];
  }
  const doc = read(first);
  const failure = baseline === undefined || doc?.microscope?.ready !== true ? null
    : ledgerOverLine(baseline, ledgerBudget(doc.microscope.checkpoints), zone);
  if (failure === null) return [first];
  log(`${failure}\nMeasuring ${zone} once more: it fails only if this reading is over the line too.`);
  return [first, await boot(2)];
}

/** Hottest run sets the extent of measured spread around the median. The
 * positive spread is kept in bytes so subsequent measurements cannot widen
 * the allowance.
 * @param {readonly number[]} readings @returns {FootprintBudget} */
export function footprintBudget(readings) {
  if (readings.length < 3 || readings.some(n => byteCount(n) === 0)) throw new Error('Need at least three native WebContent readings');
  const sorted = [...readings].sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)], upper = sorted[Math.ceil((sorted.length - 1) / 2)];
  const settled = Math.round((lower + upper) / 2);
  return { settled, spread: sorted.at(-1) - settled };
}

/** @param {FootprintBudget} baseline @param {readonly number[]} readings */
export function compareFootprint(baseline, readings) {
  const observed = footprintBudget(readings);
  const previous = byteCount(baseline.settled), limit = previous + byteCount(baseline.spread);
  if (observed.settled > limit) throw new Error(`Template settled WebContent: ${observed.settled} B > ${limit} B (baseline ${previous} B + ${baseline.spread} B spread)`);
  return { settled: Math.min(previous, observed.settled), spread: baseline.spread };
}

/** The failure one batch of native boots would raise, or null when its median is inside the line.
 * @param {FootprintBudget} baseline @param {readonly number[]} readings @returns {string | null} */
export function footprintOverLine(baseline, readings) {
  try { compareFootprint(baseline, readings); return null; } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The hosted macOS runner's Template median moves about 24 MB from run to run (564-589 MB on unchanged code), so a batch
 * whose median is over the line is measured once more (memory/ci.mjs) and fails only when every batch is over.
 * @param {FootprintBudget} baseline @param {readonly (readonly number[])[]} batches @returns {FootprintBudget}
 */
export function confirmFootprint(baseline, batches) {
  if (batches.length === 0) throw new Error('No native WebContent batches');
  const failures = [];
  for (const readings of batches) {
    const failure = footprintOverLine(baseline, readings);
    if (failure === null) return compareFootprint(baseline, readings);
    failures.push(failure);
  }
  throw new Error(`Template: ${batches.length} of ${batches.length} batches over the line\n${failures.join('\n')}`);
}

/** EM11b: which Web Inspector mode the runs were read with (measure.mjs `instrument`; a run before EM11b is `full`). The
 * `full` mode carries up to ~200 MB of retained response bodies a phone does not have, so a baseline and runs read in
 * different modes are never compared: re-record the baseline (ci.yml `memory_record`).
 * @param {readonly any[]} measurements @param {any} baseline @returns {string} */
export function footprintInstrument(measurements, baseline) {
  const modes = [...new Set(measurements.map(doc => doc.instrument ?? 'full'))];
  if (modes.length !== 1) throw new Error(`Template runs mix inspector modes: ${modes.join(', ')}`);
  const mode = /** @type {string} */ (modes[0]), stored = baseline?.instrument ?? 'full';
  if (baseline !== null && stored !== mode) throw new Error(`Template baseline was read with instrument ${stored}, these runs with ${mode}: re-record it (ci.yml memory_record)`);
  return mode;
}

/** @param {readonly LedgerBudget[]} runs @returns {LedgerBudget} */
function highWater(runs) {
  if (runs.length === 0) throw new Error('No ledger boots');
  const phase = (/** @type {keyof LedgerBudget} */ name) =>
    Object.fromEntries(SUBSYSTEMS.map(kind => [kind, Math.max(...runs.map(run => run[name][kind]))]));
  return { control: phase('control'), peak: phase('peak') };
}

/** @param {string} file @returns {any} */
function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }

/** @param {string} file @param {unknown} value */
function write(file, value) { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

/** Consume recorded measure.mjs output. Calibration and comparison never
 * share an implicit write path. A failed comparison cannot update a file.
 * @param {string[]} argv */
export function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true,
    options: { mode: { type: 'string' }, baseline: { type: 'string' }, out: { type: 'string' } } });
  const mode = values.mode;
  if (!['ledger', 'webkit-ledger', 'footprint'].includes(mode ?? '') || positionals.length === 0 || (!values.baseline && !values.out)) {
    throw new Error('Usage: ratchet.mjs --mode=ledger|webkit-ledger|footprint [--baseline=file] [--out=file] <measure.json>...');
  }
  const baseline = values.baseline ? json(values.baseline) : null;
  if (baseline !== null && (baseline.version !== 1 || baseline.mode !== mode)) throw new Error('Incompatible memory baseline');
  const measurements = positionals.map(json);
  for (const doc of measurements) if (doc.protocol !== 'memory-run/1' || typeof doc.chunk !== 'string') throw new Error('Expected measure.mjs output');
  if (mode === 'ledger' || mode === 'webkit-ledger') {
    const instrument = mode === 'webkit-ledger' ? footprintInstrument(measurements, baseline) : undefined;
    /** @type {Map<string, LedgerBudget[]>} */
    const readings = new Map();
    for (const doc of measurements) {
      const rows = readings.get(doc.chunk) ?? [];
      if (mode === 'ledger') {
        if (doc.microscope?.ready !== true) throw new Error(`${doc.chunk}: Chromium did not reach control`);
        rows.push(ledgerBudget(doc.microscope.checkpoints));
      } else {
        if (doc.chunk !== 'nine-dragon-stack' || !Array.isArray(doc.webkit) || doc.webkit.length === 0) throw new Error('Expected native WebKit Nine runs');
        for (const run of doc.webkit) {
          if (run.host !== 'webkit' || run.refused !== null || run.ready !== true) throw new Error('Nine did not reach control in native WebKit');
          rows.push(ledgerBudget(run.checkpoints));
        }
      }
      readings.set(doc.chunk, rows);
    }
    if (baseline !== null && !isDeepStrictEqual([...readings.keys()].sort(), Object.keys(baseline.zones).sort())) {
      throw new Error('Measured zone coverage differs from the committed ledger baseline');
    }
    const zones = Object.fromEntries([...readings.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([zone, runs]) =>
      [zone, baseline === null ? highWater(runs)
        : (mode === 'ledger' ? confirmLedger : compareLedger)(baseline.zones[zone], runs, zone)]));
    if (values.out) write(values.out, { version: 1, mode, instrument, zones });
    console.log(`Ledger ${baseline === null ? 'recorded' : 'passed'} for ${readings.size} zones`);
  } else {
    const batches = measurements.map(doc => {
      if (doc.chunk !== '_template' || !Array.isArray(doc.webkit) || doc.webkit.length === 0) throw new Error('Expected native WebKit Template runs');
      return doc.webkit.map((/** @type {any} */ run) => {
        if (run.host !== 'webkit' || run.refused !== null || run.ready !== true) throw new Error('Template did not reach control in native WebKit');
        return byteCount(run.settled?.webcontent);
      });
    });
    const instrument = footprintInstrument(measurements, baseline);
    const anchor = baseline === null ? footprintBudget(batches.flat()) : confirmFootprint(baseline.anchor, batches);
    if (values.out) write(values.out, { version: 1, mode, instrument, anchor });
    const medians = batches.map(readings => footprintBudget(readings).settled).join(' B, ');
    console.log(`Template native WebContent: median ${medians} B, baseline ${anchor.settled} B + ${anchor.spread} B`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
