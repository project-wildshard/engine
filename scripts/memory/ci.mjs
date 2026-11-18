// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { armedMemory, comparePhoneFootprint, footprintBootFor, guardZone, ledgerZones, phoneFootprint } from './armed.mjs';
import { loadPhoneModel } from './phoneModel.mjs';
import { compareLedger, compareFootprint, footprintBoot, footprintInstrument, ledgerBudget, main as ratchet } from './ratchet.mjs';

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
const baseline = get(new URL(`${mode}-ratchet.json`, import.meta.url));
if (baseline.version !== 1 || baseline.mode !== mode) throw new Error('Incompatible memory baseline');
const preview = await serve(absolute(root), '', true, { telemetryDir: join(directory, 'telemetry') });
/** @type {string[]} */
const files = [];
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
    // Nine never reached control on hosted SwiftShader. Its ledger stays in
    // native WebKit, with the same arming switch as the Ubuntu job.
    const available = built.filter(zone => zone !== 'nine-dragon-stack');
    const selection = process.env.WS_LEDGER_RECORD_ZONES?.trim();
    const requested = selection ? [...new Set(selection.split(',').map(zone => zone.trim()))] : available;
    if (selection && (!record || !requested.includes('_template'))) throw new Error('Partial ledger recording requires _template');
    readings = ledgerZones(available, policy.zones, requested);
  }
  const model = mode === 'ledger' ? null : loadPhoneModel();
  for (const chunk of readings) {
    const rounds = mode === 'ledger' && record ? (chunk === '_template' ? 5 : 3) : 1;
    for (let round = 1; round <= rounds; round++) await guardZone(chunk, policy.zones, async () => {
      if (!built.includes(chunk)) throw new Error('Prepared preview does not contain the zone');
      const file = join(directory, `measure-${chunk}-${round}.json`);
      const boot = footprintBootFor(chunk, policy.zones, placed);
      const host = boot === 'online'
        ? ['--online', `--dist=${absolute(root, 'dist')}`, `--scratch=${join(directory, 'online')}`]
        : [`--url=${preview.url}`];
      await measure([...host, `--chunk=${chunk}`, '--timeout=180', `--out=${file}`,
        ...(mode === 'ledger' ? ['--ledger-only'] : [mode === 'footprint' ? '--runs=5' : '--runs=3', '--instrument=minimal'])]);
      const data = get(file);
      if (data.protocol !== 'memory-run/1' || data.chunk !== chunk) throw new Error('Reading belongs to another run or zone');
      if (mode === 'ledger') {
        if (data.microscope?.ready !== true) throw new Error('Chromium did not reach control');
        const reading = ledgerBudget(data.microscope.checkpoints);
        files.push(file);
        if (!baseline.zones?.[chunk]) throw new Error('Missing committed subsystem ceilings');
        compareLedger(baseline.zones[chunk], [reading], chunk);
      } else {
        const runs = data.webkit;
        if (!Array.isArray(runs) || runs.length !== (mode === 'footprint' ? 5 : 3)) throw new Error('Incomplete native boot batch');
        const footprint = phoneFootprint(chunk, runs, model, boot);
        console.log(`${chunk}: EM11 (${boot}) upper playing ${footprint.playing} B, loading ${footprint.loading} B`);
        if (mode === 'webkit-ledger') {
          const nativeLedger = runs.map(run => ledgerBudget(run.checkpoints));
          footprintInstrument([data], baseline);
          footprintBoot([data], baseline);
          files.push(file);
          if (!baseline.zones?.[chunk]) throw new Error('Missing committed native WebKit subsystem ceilings');
          compareLedger(baseline.zones[chunk], nativeLedger, chunk);
        } else {
          comparePhoneFootprint(footprint, policy.lines);
          if (chunk === '_template' && boot === 'standalone') {
            footprintInstrument([data], baseline);
            footprintBoot([data], baseline);
            files.push(file);
            compareFootprint(baseline.anchor, runs.map(run => run.settled.webcontent));
          }
        }
      }
    }, console.log);
  }
  if (files.length > 0) {
    const next = join(directory, `${mode}-ratchet.json`);
    // Keep each measured high as evidence. Recording cannot replace or skip
    // the committed ceilings compared above.
    ratchet([`--mode=${mode}`, `--out=${next}`, ...files]);
    if (mode === 'ledger' && record) await guardZone('_template', policy.zones, async () => {
      const anchor = get(next).zones._template;
      if (!anchor) throw new Error('No Template ledger for the negative control');
      const clean = join(directory, 'template-clean.json'), planted = join(directory, 'template-planted.json');
      const args = [`--url=${preview.url}`, '--chunk=_template', '--timeout=180', '--ledger-only'];
      await measure([...args, `--out=${clean}`]);
      await measure([...args, '--plant-retained-buffer', `--out=${planted}`]);
      try {
        compareLedger(anchor, [ledgerBudget(get(planted).microscope.checkpoints)], '_template');
        throw new Error('Expected the retained 20 MB buffer to exceed the loading budget');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('_template control loading:')) throw error;
        console.log(error.message);
      }
      compareLedger(anchor, [ledgerBudget(get(clean).microscope.checkpoints)], '_template');
    }, console.log);
  }
} finally { preview.close(); await preview.closed; }
