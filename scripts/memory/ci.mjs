// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { compareLedger, ledgerBudget, ledgerOverLine, main as ratchet } from './ratchet.mjs';

const [mode, root, output, baseline] = process.argv.slice(2);
if (!['ledger', 'webkit-ledger', 'footprint'].includes(mode) || !root || !output) {
  throw new Error('Usage: memory/ci.mjs ledger|webkit-ledger|footprint <preview root> <output> [baseline]');
}
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

/** @param {string} file */
const get = file => JSON.parse(readFileSync(file, 'utf8'));
// One hosted boot is one sample (memory/ratchet.mjs confirmLedger): a zone whose
// first reading is over the line is measured once more and fails only if both are.
const stored = mode === 'ledger' && baseline ? get(baseline).zones : null;

const preview = await serve(absolute(root), '', true, { telemetryDir: join(directory, 'telemetry') });
const files = [];
try {
  let readings = mode === 'footprint' ? ['_template'] : ['nine-dragon-stack'];
  if (mode === 'ledger') {
    const built = readdirSync(join(root, 'dist', 'shardfiles'), { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const catalogue = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8'));
    const expected = catalogue.shards.map((/** @type {{slug:string}} */ { slug }) => slug === 'template' ? '_template' : slug).sort();
    if (JSON.stringify(built) !== JSON.stringify(expected)) throw new Error('Prepared preview must contain every catalogue pin');
    // Nine timed out on hosted SwiftShader at 180 and 480 seconds (EM35).
    // The macOS job reads its native WebKit ledger from the pinned Nine build.
    readings = built.filter(chunk => chunk !== 'nine-dragon-stack');
    const selection = process.env.WS_LEDGER_RECORD_ZONES?.trim();
    if (selection) {
      const requested = [...new Set(selection.split(',').map(chunk => chunk.trim()))];
      if (baseline || !requested.includes('_template') || requested.some(chunk => !readings.includes(chunk))) {
        throw new Error('Partial ledger recording requires _template and known Ubuntu zones');
      }
      readings = readings.filter(chunk => requested.includes(chunk));
    }
  }
  for (const chunk of readings) {
    const rounds = mode === 'ledger' && !baseline ? (chunk === '_template' ? 5 : 3) : 1;
    for (let i = 0; i < rounds; i++) {
      const file = join(directory, `measure-${chunk}-${i + 1}.json`);
      await measure([`--url=${preview.url}`, `--chunk=${chunk}`, '--timeout=180', `--out=${file}`,
        ...(mode === 'ledger' ? ['--ledger-only'] : [mode === 'footprint' ? '--runs=5' : '--runs=3'])]);
      files.push(file);
    }
    const first = stored?.[chunk] === undefined ? null : get(files.at(-1));
    const failure = first?.microscope?.ready === true
      ? ledgerOverLine(stored[chunk], ledgerBudget(first.microscope.checkpoints), chunk) : null;
    if (failure !== null) {
      console.log(`${failure}\nMeasuring ${chunk} once more: it fails only if this reading is over the line too.`);
      const file = join(directory, `measure-${chunk}-2.json`);
      await measure([`--url=${preview.url}`, `--chunk=${chunk}`, '--timeout=180', `--out=${file}`, '--ledger-only']);
      files.push(file);
    }
  }
  const next = join(directory, `${mode}-ratchet.json`);
  ratchet([`--mode=${mode}`, `--out=${next}`, ...(baseline ? [`--baseline=${baseline}`] : []), ...files]);
  if (mode === 'ledger' && !baseline) {
    const control = get(next).zones._template;
    const clean = join(directory, 'template-clean.json'), planted = join(directory, 'template-planted.json');
    const args = [`--url=${preview.url}`, '--chunk=_template', '--timeout=180', '--ledger-only'];
    await measure([...args, `--out=${clean}`]);
    await measure([...args, '--plant-retained-buffer', `--out=${planted}`]);
    try {
      compareLedger(control, [ledgerBudget(get(planted).microscope.checkpoints)], '_template');
      throw new Error('Expected the held 20 MB buffer to exceed the loading budget');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('_template control loading:')) throw error;
      console.log(message);
    }
    compareLedger(control, [ledgerBudget(get(clean).microscope.checkpoints)], '_template');
    console.log('Unchanged Template passes the budget comparison');
  }
} finally { preview.close(); await preview.closed; }
