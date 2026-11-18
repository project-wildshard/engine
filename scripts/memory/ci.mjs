// Hosted memory measurements use one exact prepared client per job.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { serve } from '../parity/serve.mjs';
import { compareLedger, confirmZone, footprintOverLine, ledgerBudget, main as ratchet } from './ratchet.mjs';

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
// One hosted boot is one sample (memory/ratchet.mjs confirmZone): a zone whose first
// boot is over the line or never reaches control is booted once more.
const stored = mode === 'ledger' && baseline ? get(baseline).zones : null;
// The native Template footprint gets the same rule: a batch whose median is over the line is measured once more.
const anchor = mode === 'footprint' && baseline ? get(baseline).anchor : null;
// J424: only an armed zone (its baseline says "armed": true) can block, so only an armed zone gets the second boot. Any
// other zone boots once, and a boot that fails is printed and blocks nothing (memory/ratchet.mjs guardZones).
const armed = (/** @type {string} */ chunk) => {
  if (!baseline) return true;
  const doc = get(baseline);
  return (mode === 'footprint' ? doc.anchor : doc.zones?.[chunk])?.armed === true;
};

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
    const boot = async (/** @type {number} */ round) => {
      const file = join(directory, `measure-${chunk}-${round}.json`);
      await measure([`--url=${preview.url}`, `--chunk=${chunk}`, '--timeout=180', `--out=${file}`,
        ...(mode === 'ledger' ? ['--ledger-only'] : [mode === 'footprint' ? '--runs=5' : '--runs=3'])]);
      return file;
    };
    if (!armed(chunk)) {
      try { files.push(await boot(1)); } catch (error) {
        console.log(`REPORT, not armed, blocks nothing (J424):\n${chunk}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    if (stored !== null) {
      files.push(...await confirmZone({ zone: chunk, baseline: stored[chunk], boot, read: get, log: line => { console.log(line); } }));
      continue;
    }
    for (let i = 0; i < rounds; i++) files.push(await boot(i + 1));
    if (anchor === null) continue;
    const settled = get(files.at(-1) ?? '').webkit?.map((/** @type {any} */ run) => run.settled?.webcontent);
    const failure = Array.isArray(settled) && settled.every(n => typeof n === 'number') ? footprintOverLine(anchor, settled) : null;
    if (failure !== null) {
      console.log(`${failure}\nMeasuring ${chunk} once more: it fails only if this batch is over the line too.`);
      files.push(await boot(2));
    }
  }
  const next = join(directory, `${mode}-ratchet.json`);
  if (files.length === 0) console.log(`No ${mode} reading to compare; nothing here is armed, so this blocks nothing (J424)`);
  else ratchet([`--mode=${mode}`, `--out=${next}`, ...(baseline ? [`--baseline=${baseline}`] : []), ...files]);
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
