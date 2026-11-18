// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { compareLedger, ledgerBudget, main as ratchet } from './ratchet.mjs';

const [mode, root, output, baseline] = process.argv.slice(2);
if (!['ledger', 'footprint'].includes(mode) || !root || !output) {
  throw new Error('Usage: memory/ci.mjs ledger|footprint <preview root> <output> [baseline]');
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

const preview = await serve(absolute(root), '', true, { telemetryDir: join(directory, 'telemetry') });
const files = [];
try {
  const readings = mode === 'footprint' ? ['_template'] :
    readdirSync(join(root, 'dist', 'shardfiles'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (mode === 'ledger') {
    const catalogue = JSON.parse(readFileSync('test/pins/catalogue.json', 'utf8'));
    const expected = catalogue.shards.map((/** @type {{slug:string}} */ { slug }) => slug === 'template' ? '_template' : slug).sort();
    if (JSON.stringify(readings) !== JSON.stringify(expected)) throw new Error('Prepared preview must contain every catalogue pin');
  }
  for (const chunk of readings) {
    const rounds = mode === 'ledger' && !baseline ? (chunk === '_template' ? 5 : 3) : 1;
    for (let i = 0; i < rounds; i++) {
      const file = join(directory, `measure-${chunk}-${i + 1}.json`);
      await measure([`--url=${preview.url}`, `--chunk=${chunk}`, '--timeout=180', `--out=${file}`,
        ...(mode === 'ledger' ? ['--ledger-only'] : ['--runs=5'])]);
      files.push(file);
    }
  }
  const next = join(directory, `${mode}-ratchet.json`);
  ratchet([`--mode=${mode}`, `--out=${next}`, ...(baseline ? [`--baseline=${baseline}`] : []), ...files]);
  if (mode === 'ledger' && !baseline) {
    const get = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
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
