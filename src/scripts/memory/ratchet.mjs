// EM35–EM36. Byte budgets for ledger capacity and native WebContent footprint have separate baselines. BUDGET-CAPS BC11:
// every comparison here judges through src/scripts/budgets/verdict.mjs (baseline + max(10%, the cap's floor)); no margin of
// its own. The CI gates themselves are src/scripts/memory/ci.mjs with ledgerVerdict.mjs; this file is the replay tool.
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { memorySubsystems, PHONE_MEMORY_BUDGETS } from '../../shared/engine/core/memoryBudget.ts';
import { capFor, readCaps } from '../budgets/files.mjs';
import { verdict } from '../budgets/verdict.mjs';

const SUBSYSTEMS = Object.keys(PHONE_MEMORY_BUDGETS);
const LEDGER_PHASES = ['control', 'peak'];

/** @typedef {import('../../shared/engine/core/memoryBudget.ts').BudgetLedger} BudgetLedger */
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

/** The regression floor of a ledger total, from budgets/caps.json (`ledger/*`). */
const LEDGER_FLOOR = capFor(readCaps(), 'ledger/_')?.floor ?? 0;

/** @param {Record<string, number> | undefined} phase */
function phaseTotal(phase) {
  let total = 0;
  for (const kind of SUBSYSTEMS) total += byteCount(phase?.[kind]);
  return total;
}

/**
 * Replay a historical comparison against a subsystem ledger: each phase's total through the budget verdict, the same
 * content on both sides (BUDGET-CAPS BC6, BC11). The subsystems are summed, not judged one by one. It never lowers the
 * stored ledger: nothing lowers itself.
 * @param {LedgerBudget} baseline @param {readonly LedgerBudget[]} runs
 * @param {string} zone @returns {LedgerBudget}
 */
export function compareLedger(baseline, runs, zone) {
  if (runs.length === 0) throw new Error(`${zone}: no successful ledger boots`);
  const failures = [];
  for (const phase of LEDGER_PHASES) {
    const previous = phaseTotal(baseline[phase]);
    const observed = Math.max(...runs.map(run => phaseTotal(run[phase])));
    const result = verdict({ measure: observed, baseline: { value: previous, contentKey: zone }, hard: null, contentKey: zone, kind: 'exact', floor: LEDGER_FLOOR });
    if (result.status === 'regressed') failures.push(`${zone} ${phase} total: ${observed} B > ${Math.ceil(Number(result.line))} B (baseline ${previous} B + max(10%, ${LEDGER_FLOOR} B))`);
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
  return { control: { ...baseline.control }, peak: { ...baseline.peak } };
}

/**
 * For a manual replay a Chromium boot is one sample: control "loading" swings by 3–4 MB
 * with how many ring tiles happen to be resident, so a single over-line
 * reading can be retried and the replay fails only when every
 * reading is over. A retained allocation shows in every boot and still fails.
 * @param {LedgerBudget} baseline @param {readonly LedgerBudget[]} runs
 * @param {string} zone @returns {LedgerBudget}
 */
export function confirmLedger(baseline, runs, zone) {
  if (runs.length === 0) throw new Error(`${zone}: no successful ledger boots`);
  const failures = [];
  if (runs.length === 3 && runs.every(run => ledgerOverLine(baseline, run, zone) === null)) return compareLedger(baseline, runs, zone);
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
 * Read one hosted zone for a diagnostic replay. A boot that is over the line,
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

/** A batch's settled reading (its median) and the spread of its hottest run above it, for the report.
 * @param {readonly number[]} readings @returns {FootprintBudget} */
export function footprintBudget(readings) {
  if (readings.length < 3 || readings.some(n => byteCount(n) === 0)) throw new Error('Need at least three native WebContent readings');
  const sorted = [...readings].sort((a, b) => a - b);
  const lower = sorted[Math.floor((sorted.length - 1) / 2)], upper = sorted[Math.ceil((sorted.length - 1) / 2)];
  const settled = Math.round((lower + upper) / 2);
  return { settled, spread: sorted.at(-1) - settled };
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

/** STR1 (J415): which boot the runs were read on (measure.mjs `boot`: `online`, or `standalone` for a run before STR1). An
 * online boot carries no in-page server worker (99 to 139 MB [K]), so runs of different boots, a pair's mixed document
 * (`online+standalone`) or a baseline of the other boot are never compared: re-record the baseline.
 * @param {readonly any[]} measurements @param {any} baseline @returns {string} */
export function footprintBoot(measurements, baseline) {
  const boots = [...new Set(measurements.map(doc => doc.boot ?? 'standalone'))];
  if (boots.length !== 1 || boots[0].includes('+')) throw new Error(`runs mix boots: ${boots.join(', ')}`);
  const boot = /** @type {string} */ (boots[0]), stored = baseline?.boot ?? 'standalone';
  if (baseline !== null && stored !== boot) throw new Error(`baseline was read on the ${stored} boot, these runs on the ${boot} boot: re-record it (ci.yml memory_record)`);
  return boot;
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
  // The Template footprint is judged by src/scripts/memory/ci.mjs footprint against budgets/baselines.json (BC11).
  if (!['ledger', 'webkit-ledger'].includes(mode ?? '') || positionals.length === 0 || (!values.baseline && !values.out)) {
    throw new Error('Usage: ratchet.mjs --mode=ledger|webkit-ledger [--baseline=file] [--out=file] <measure.json>...');
  }
  const baseline = values.baseline ? json(values.baseline) : null;
  if (baseline !== null && (baseline.version !== 1 || baseline.mode !== mode)) throw new Error('Incompatible memory baseline');
  const measurements = positionals.map(json);
  for (const doc of measurements) if (doc.protocol !== 'memory-run/1' || typeof doc.chunk !== 'string') throw new Error('Expected measure.mjs output');
  const instrument = mode === 'webkit-ledger' ? footprintInstrument(measurements, baseline) : undefined;
  const boot = mode === 'webkit-ledger' ? footprintBoot(measurements, baseline) : undefined;
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
  if (values.out) write(values.out, { version: 1, mode, instrument, boot, zones });
  console.log(`Ledger ${baseline === null ? 'recorded' : 'passed'} for ${readings.size} zones`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
