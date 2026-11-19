// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { armedMemory, comparePhoneFootprint, footprintBootFor, guardZone, ledgerZones, phoneFootprint } from './armed.mjs';
import { checkMemory, memoryWarningLine } from './gate.mjs';
import { loadPhoneModel } from './phoneModel.mjs';
import { compareLedger, compareFootprint, footprintBoot, footprintBudget, footprintInstrument, ledgerBudget } from './ratchet.mjs';

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
  const command = [process.execPath, 'scripts/memory/measure.mjs', ...args];
  const [file, ...parameters] = process.platform === 'darwin' ? ['bash', 'scripts/browser-lane.sh', ...command] : command;
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
try {
  const built = readdirSync(join(root, 'dist', 'shardfiles'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  /** @type {Set<string>} */
  const placed = mode === 'footprint'
    ? new Set(get(join(root, 'dist', 'catalogue.json')).grid.cells.map((/** @type {{slug:string}} */ cell) => cell.slug))
    : new Set();
  let readings = mode === 'footprint'
    ? [...new Set(['_template', ...policy.zones])]
    : ['nine-dragon-stack'];
  if (mode === 'ledger') {
    const catalogue = get('test/pins/catalogue.json');
    const expected = catalogue.shards.map((/** @type {{slug:string}} */ { slug }) => slug === 'template' ? '_template' : slug).sort();
    if (JSON.stringify(built) !== JSON.stringify(expected)) throw new Error('Prepared preview must contain every catalogue pin');
    // Nine never reached control on hosted SwiftShader. Its ledger reads
    // the online native WebKit boot with the same arming switch.
    const available = built.filter(zone => zone !== 'nine-dragon-stack');
    const selection = process.env.WS_LEDGER_RECORD_ZONES?.trim();
    const requested = selection ? [...new Set(selection.split(',').map(zone => zone.trim()))] : available;
    if (selection && (!record || !requested.includes('_template'))) throw new Error('Partial ledger recording requires _template');
    readings = ledgerZones(available, policy.zones, requested);
  }
  const model = mode === 'ledger' ? null : loadPhoneModel();
  let standaloneTemplate = 'unavailable';
  if (mode === 'footprint') await guardZone('standalone Template preview', new Set(), async () => {
    const file = join(directory, 'measure-_template-standalone.json');
    await measure([`--url=${preview.url}`, '--chunk=_template', '--timeout=180', '--runs=5', '--instrument=minimal', `--out=${file}`]);
    const runs = nativeRuns(measurement(file, '_template'), 5);
    const footprint = phoneFootprint('_template', runs, model, 'standalone');
    standaloneTemplate = `${footprintBudget(runs.map(run => run.settled.webcontent)).settled} B`;
    console.log(`Template standalone preview settled WebContent [K] ${standaloneTemplate}`);
    comparePhoneFootprint(footprint, policy.lines);
  }, console.log);
  for (const chunk of readings) await guardZone(chunk, policy.zones, async () => {
    if (!built.includes(chunk)) throw new Error('Prepared preview does not contain the zone');
    const onlineBaseline = mode === 'webkit-ledger' || (mode === 'footprint' && chunk === '_template');
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

    if (mode === 'footprint' && chunk === '_template') {
      const data = await capture(3), runs = nativeRuns(data, 3);
      footprintInstrument([data], baseline);
      footprintBoot([data], baseline);
      const settled = runs.map(run => run.settled.webcontent);
      const comparison = `Template settled WebContent [K] online ${footprintBudget(settled).settled} B, standalone preview ${standaloneTemplate}`;
      console.log(comparison);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${comparison}\n\n`);
      recorded.anchor = compareFootprint(baseline.anchor, settled);
      return;
    }

    /** @param {import('./gate.mjs').Warning} warning */
    function warn(warning) {
      if (!policy.zones.has(chunk)) return;
      const line = memoryWarningLine(mode, chunk, warning);
      console.log(process.env.GITHUB_ACTIONS === 'true' ? `::warning title=Memory gate::${line}` : line);
    }

    if (mode === 'footprint') {
      const pinned = policy.readings.get(chunk);
      const metrics = {
        playing: { absolute: policy.lines.playingBytes, ...(pinned && {
          baseline: pinned.playingBytes, previousMargin: Math.floor(pinned.playingBytes / 200),
        }) },
        loading: { absolute: policy.lines.loadingBytes, ...(pinned && {
          baseline: pinned.loadingBytes, previousMargin: Math.floor(pinned.loadingBytes / 200),
        }) },
      };
      /** @param {number} count */
      const probeFootprint = async count => nativeRuns(await capture(count), count).map(run => {
        const { playing, loading } = phoneFootprint(chunk, [run], model, boot);
        return { playing, loading };
      });
      const [first] = await probeFootprint(1);
      console.log(`${chunk}: EM11 (${boot}) upper playing ${first.playing} B, loading ${first.loading} B`);
      const next = await checkMemory({ zone: chunk, metrics, first, remeasure: probeFootprint, warn, record });
      recorded[chunk] = { playingBytes: next.playing, loadingBytes: next.loading };
      return;
    }

    if (!baseline.zones?.[chunk]) throw new Error('Missing committed subsystem ceilings');
    const pinned = baseline.zones[chunk];
    const metrics = Object.fromEntries(Object.entries(flatLedger(pinned)).map(([metric, bytes]) =>
      [metric, { baseline: bytes, previousMargin: Math.floor(bytes * 0.02) }]));
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
    const next = await checkMemory({ zone: chunk, metrics, first, remeasure: probe, warn, record });
    recorded[chunk] = Object.fromEntries(Object.entries(pinned).map(([phase, bytes]) =>
      [phase, Object.fromEntries(Object.keys(bytes).map(kind => [kind, next[`${phase}.${kind}`]]))]));
  }, console.log);
  if (record) {
    const outputFile = join(directory, `${mode}-ratchet.json`);
    const { anchor = baseline.anchor, ...zones } = recorded;
    writeFileSync(outputFile, `${JSON.stringify(mode === 'footprint'
      ? { ...baseline, anchor, zones } : { ...baseline, zones: { ...baseline.zones, ...zones } }, null, 2)}\n`);
    if (mode === 'ledger' && record) await guardZone('_template', policy.zones, async () => {
      const controlAnchor = get(outputFile).zones._template;
      if (!controlAnchor) throw new Error('No Template ledger for the negative control');
      const clean = join(directory, 'template-clean.json'), planted = join(directory, 'template-planted.json');
      const args = [`--url=${preview.url}`, '--chunk=_template', '--timeout=180', '--ledger-only'];
      await measure([...args, `--out=${clean}`]);
      await measure([...args, '--plant-retained-buffer', `--out=${planted}`]);
      try {
        compareLedger(controlAnchor, [ledgerBudget(get(planted).microscope.checkpoints)], '_template');
        throw new Error('Expected the retained 20 MB buffer to exceed the loading budget');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('_template control loading:')) throw error;
        console.log(error.message);
      }
      compareLedger(controlAnchor, [ledgerBudget(get(clean).microscope.checkpoints)], '_template');
    }, console.log);
  }
} finally { preview.close(); await preview.closed; }
