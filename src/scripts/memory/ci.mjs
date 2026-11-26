// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { armedMemory, CONTROL_ZONE, comparePhoneFootprint, footprintBootFor, footprintLines, guardZone, judgeFootprint, ledgerZones, phoneFootprint } from './armed.mjs';
import { loadPhoneModel } from './phoneModel.mjs';
import { compareLedger, footprintBoot, footprintBudget, footprintInstrument, ledgerBudget } from './ratchet.mjs';
import { checkLedger, checkReads, judgeReads, ledgerFailure, reportLedger, zoneContentKey } from './ledgerVerdict.mjs';
import { readBaselines, readCaps } from '../budgets/files.mjs';
import { pinnedContentKeys } from '../shard-size-gate.mjs';

const [mode, root, output, recordFlag, ...extra] = process.argv.slice(2);
if (!['ledger', 'webkit-ledger', 'footprint'].includes(mode) || !root || !output || extra.length > 0
    || (recordFlag !== undefined && recordFlag !== '--record')) {
  throw new Error('Usage: memory/ci.mjs ledger|webkit-ledger|footprint <preview root> <output> [--record]');
}
const record = recordFlag === '--record';
const policy = armedMemory();
const directory = absolute(output);
mkdirSync(directory, { recursive: true });

/** @param {string[]} args */
async function measure(args) {
  const command = [process.execPath, 'src/scripts/memory/measure.mjs', ...args];
  const [file, ...parameters] = process.platform === 'darwin' ? ['bash', 'src/scripts/browser-lane.sh', ...command] : command;
  const child = spawn(file, parameters, { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) throw new Error(`Measurement exited ${String(code)}: ${args.join(' ')}`);
}

/** @param {string | URL} file */
const get = file => JSON.parse(readFileSync(file, 'utf8'));

/** @param {string} file @param {string} chunk */
function measurement(file, chunk) {
  const data = get(file);
  if (data.protocol !== 'memory-run/1' || data.chunk !== chunk) throw new Error('Reading belongs to another run or zone');
  return data;
}

/** @param {any} data @param {number} count @returns {any[]} */
function nativeRuns(data, count) {
  if (!Array.isArray(data.webkit) || data.webkit.length !== count) throw new Error('Incomplete native boot batch');
  return data.webkit;
}

/** @param {ReturnType<typeof ledgerBudget>} reading */
function flatLedger(reading) {
  return Object.fromEntries(Object.entries(reading).flatMap(([phase, bytes]) =>
    Object.entries(bytes).map(([kind, value]) => [`${phase}.${kind}`, value])));
}

const baseline = get(new URL(`${mode}-ratchet.json`, import.meta.url));
if (baseline.version !== 1 || baseline.mode !== mode) throw new Error('Incompatible memory baseline');
const preview = await serve(absolute(root), '', true, { telemetryDir: join(directory, 'telemetry') });
/** @type {Record<string, any>} */
const recorded = {};
// BUDGET-CAPS BC6, BC11: every mode judges through the budget verdict (the ledgers on two totals a zone, the footprint on
// each armed zone's EM11 playing and loading and the Template's settled WebContent); every judged row goes in one table
// and in budget-measures.json (src/scripts/budgets/cli.mjs record --run reads it from the run's artifact). J445: the 1.0 GB
// playing line is a target that refuses nothing; 1.5 GB loading (memory/loading/* in budgets/caps.json) is the one refusal.
const budgets = { caps: readCaps(), baselines: readBaselines() }, pins = pinnedContentKeys(), lines = footprintLines(budgets.caps);
/** @type {any[]} */
const budgetRows = [];
/** @type {string[]} */
const ledgerFailures = [];
try {
  const built = readdirSync(join(root, 'dist', 'shardfiles'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  /** @type {Set<string>} */
  const placed = mode === 'footprint'
    ? new Set(get(join(root, 'dist', 'catalogue.json')).grid.cells.map((/** @type {{slug:string}} */ cell) => cell.slug))
    : new Set();
  let readings = mode === 'footprint'
    ? [...new Set([CONTROL_ZONE, ...policy.zones])]
    : ['nine-dragon-stack'];
  if (mode === 'ledger') {
    const catalogue = get('test/pins/catalogue.json');
    const expected = catalogue.shards.map((/** @type {{slug:string}} */ { slug }) => slug).sort();
    if (JSON.stringify(built) !== JSON.stringify(expected)) throw new Error('Prepared preview must contain every catalogue pin');
    // Nine never reached control on hosted SwiftShader. Its ledger reads
    // the online native WebKit boot with the same arming switch.
    const available = built.filter(zone => zone !== 'nine-dragon-stack');
    const selection = process.env.WS_LEDGER_RECORD_ZONES?.trim();
    const requested = selection ? [...new Set(selection.split(',').map(zone => zone.trim()))] : available;
    if (selection && (!record || !requested.includes(CONTROL_ZONE))) throw new Error(`Partial ledger recording requires ${CONTROL_ZONE}`);
    readings = ledgerZones(available, policy.zones, requested);
  }
  const model = mode === 'ledger' ? null : loadPhoneModel();
  let standaloneTemplate = 'unavailable';
  if (mode === 'footprint') await guardZone('standalone Template preview', new Set(), async () => {
    const file = join(directory, `measure-${CONTROL_ZONE}-standalone.json`);
    await measure([`--url=${preview.url}`, `--chunk=${CONTROL_ZONE}`, '--timeout=180', '--runs=5', '--instrument=minimal', `--out=${file}`]);
    const runs = nativeRuns(measurement(file, CONTROL_ZONE), 5);
    const footprint = phoneFootprint(CONTROL_ZONE, runs, model, 'standalone');
    standaloneTemplate = `${footprintBudget(runs.map(run => run.settled.webcontent)).settled} B`;
    console.log(`Control standalone preview settled WebContent [K] ${standaloneTemplate}`);
    const target = comparePhoneFootprint(footprint, lines);
    if (target !== null) console.log(`${CONTROL_ZONE} standalone: ${target}`);
  }, console.log);
  for (const chunk of readings) await guardZone(chunk, policy.zones, async () => {
    if (!built.includes(chunk)) throw new Error('Prepared preview does not contain the zone');
    const onlineBaseline = mode === 'webkit-ledger' || (mode === 'footprint' && chunk === CONTROL_ZONE);
    const boot = onlineBaseline ? 'online' : footprintBootFor(chunk, policy.zones, placed);
    const host = boot === 'online'
      ? ['--online', `--dist=${absolute(root, 'dist')}`, `--scratch=${join(directory, 'online')}`]
      : [`--url=${preview.url}`];
    const args = [...host, `--chunk=${chunk}`, '--timeout=180'];
    let round = 0;
    /** @param {number} count */
    async function capture(count) {
      const file = join(directory, `measure-${chunk}-${++round}.json`);
      await measure([...args, `--out=${file}`, ...(mode === 'ledger' ? ['--ledger-only'] : [`--runs=${count}`, '--instrument=minimal'])]);
      return measurement(file, chunk);
    }

    if (mode === 'footprint' && chunk === CONTROL_ZONE) {
      const data = await capture(3), runs = nativeRuns(data, 3);
      footprintInstrument([data], baseline);
      footprintBoot([data], baseline);
      const settled = runs.map(run => run.settled.webcontent);
      const comparison = `Control (${CONTROL_ZONE}) settled WebContent [K] online ${footprintBudget(settled).settled} B, standalone preview ${standaloneTemplate}`;
      console.log(comparison);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${comparison}\n\n`);
      const rows = [judgeReads(budgets, `footprint/${CONTROL_ZONE}/settled`, settled, zoneContentKey(chunk, pins))];
      budgetRows.push(...rows);
      const failure = ledgerFailure(rows);
      if (failure !== null) ledgerFailures.push(failure);
      // The control is an armed zone too (Brasscap, J434): its own footprint lines are judged below as well.
      if (!policy.zones.has(chunk)) return;
    }

    if (mode === 'footprint') {
      /** @param {number} count */
      const probeFootprint = async count => nativeRuns(await capture(count), count).map(run => {
        const { playing, loading } = phoneFootprint(chunk, [run], model, boot);
        return { playing, loading };
      });
      const [first] = await probeFootprint(1);
      console.log(`${chunk}: EM11 (${boot}) upper playing ${first.playing} B, loading ${first.loading} B`);
      const contentKey = zoneContentKey(chunk, pins);
      const { rows } = await checkReads({ first, remeasure: probeFootprint, record,
        judge: reads => judgeFootprint({ zone: chunk, reads, contentKey, budgets }) });
      budgetRows.push(...rows);
      for (const row of rows) if (row.target !== null && row.value !== null && row.value > row.target) {
        console.log(`${chunk}: ${row.key} ${row.value} B past the ${row.target} B target (J445: the may-crash card with Play anyway, never a refusal)`);
      }
      // Past the 1.5 GB loading cap refuses an armed zone now (guardZone); a regression is reported once at the end.
      const hard = ledgerFailure(rows.filter(row => row.status === 'over-hard'));
      if (hard !== null) throw new Error(hard);
      const failure = ledgerFailure(rows);
      if (failure !== null) ledgerFailures.push(failure);
      return;
    }

    if (!baseline.zones?.[chunk]) throw new Error('Missing committed subsystem ledger');
    const pinnedLedger = baseline.zones[chunk];
    /** @param {number} count */
    async function probe(count) {
      if (mode === 'webkit-ledger') {
        const data = await capture(count), runs = nativeRuns(data, count);
        footprintInstrument([data], baseline);
        footprintBoot([data], baseline);
        return runs.map(run => flatLedger(ledgerBudget(run.checkpoints)));
      }
      const values = [];
      for (let i = 0; i < count; i++) {
        const data = await capture(1);
        if (data.microscope?.ready !== true) throw new Error('Chromium did not reach control');
        values.push(flatLedger(ledgerBudget(data.microscope.checkpoints)));
      }
      return values;
    }
    const [first] = await probe(1);
    const { rows, reads } = await checkLedger({ mode, zone: chunk, first, remeasure: probe, contentKey: zoneContentKey(chunk, pins), budgets, record });
    budgetRows.push(...rows);
    const median = (/** @type {string} */ metric) => reads.map(read => read[metric]).sort((a, b) => a - b)[Math.floor(reads.length / 2)];
    recorded[chunk] = Object.fromEntries(Object.entries(pinnedLedger).map(([phase, bytes]) =>
      [phase, Object.fromEntries(Object.keys(bytes).map(kind => [kind, median(`${phase}.${kind}`)]))]));
    // Every zone is read and tabled before the run decides: a regression is reported once at the end (BC9).
    const failure = ledgerFailure(rows);
    if (failure !== null) ledgerFailures.push(failure);
  }, console.log);
  reportLedger({ rows: budgetRows, mode, directory, commit: process.env.GITHUB_SHA, summaryFile: process.env.GITHUB_STEP_SUMMARY });
  if (ledgerFailures.length > 0) {
    console.log(ledgerFailures.join('\n'));
    process.exitCode = 1;
  }
  // The footprint's measures are all in budget-measures.json; the ledgers also keep their subsystem file.
  if (record && mode !== 'footprint') {
    const outputFile = join(directory, `${mode}-ratchet.json`);
    writeFileSync(outputFile, `${JSON.stringify({ ...baseline, zones: { ...baseline.zones, ...recorded } }, null, 2)}\n`);
    if (mode === 'ledger' && record) await guardZone(CONTROL_ZONE, policy.zones, async () => {
      const controlAnchor = get(outputFile).zones[CONTROL_ZONE];
      if (!controlAnchor) throw new Error(`No ${CONTROL_ZONE} ledger for the negative control`);
      const clean = join(directory, 'template-clean.json'), planted = join(directory, 'template-planted.json');
      const args = [`--url=${preview.url}`, `--chunk=${CONTROL_ZONE}`, '--timeout=180', '--ledger-only'];
      await measure([...args, `--out=${clean}`]);
      await measure([...args, '--plant-retained-buffer', `--out=${planted}`]);
      try {
        compareLedger(controlAnchor, [ledgerBudget(get(planted).microscope.checkpoints)], CONTROL_ZONE);
        throw new Error('Expected the retained 20 MB buffer to push the control total past its line');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes(`${CONTROL_ZONE} control total:`)) throw error;
        console.log(error.message);
      }
      compareLedger(controlAnchor, [ledgerBudget(get(clean).microscope.checkpoints)], CONTROL_ZONE);
    }, console.log);
  }
} finally { preview.close(); await preview.closed; }
