#!/usr/bin/env node
// GR12 R4/T1/T6: explicit plan-end reading, never a hook, build or CI gate.
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** @param {string} text @returns {number | null} */
export function maximumResidentBytes(text) {
  const match = /^\s*(\d+)\s+maximum resident set size\s*$/mu.exec(text);
  if (match === null) return null;
  const bytes = Number(match[1]);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

/** Original Mac default-four versus eight comparison, then one full typed lint.
 * No generator, incremental cache, output emission or CI partition change.
 * @returns {readonly {name:string, executable:string, args:readonly string[]}[]} */
export function readingCommands() {
  const compiler = resolve(root, 'node_modules/.bin/tsc');
  return [4, 8].map(checkers => ({ name: `root-checkers-${checkers}`, executable: compiler,
    args: ['--noEmit', '--incremental', 'false', '--checkers', String(checkers), '-p', 'tsconfig.json'] }))
    .concat([{ name: 'full-typed-lint', executable: process.execPath, args: ['scripts/lint-all.mjs'] }]);
}

/** Enumerate actual compiler inputs, including imported JSON, without checking.
 * Authored JSON stays typed; no ambient module or resolveJsonModule escape.
 * @param {string} project */
export function compilerJsonInputs(project) {
  const result = spawnSync(resolve(root, 'node_modules/.bin/tsc'), ['--listFilesOnly', '-p', project],
    { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error !== undefined || result.status !== 0) throw new Error(`Input census failed for ${project}: ${result.error?.message ?? result.stdout + result.stderr}`);
  const files = result.stdout.split(/\r?\n/u).filter(file => isAbsolute(file) && file.endsWith('.json'))
    .map(file => relative(root, file).replaceAll('\\', '/')).filter(file => !file.startsWith('../') && !file.startsWith('node_modules/'));
  const generated = files.filter(file => file.endsWith('.generated.json'));
  const bytes = (/** @type {readonly string[]} */ names) => names.reduce((total, file) => total + statSync(resolve(root, file)).size, 0);
  return { project, json: files, jsonBytes: bytes(files), generated, generatedBytes: bytes(generated) };
}

/** @param {string[]} args */
function main(args) {
  const measure = args[0] === '--measure';
  if ((!measure && args.length > 0) || (measure && args.length !== 2)) throw new Error('Use no args for input census, or --measure tmp/<owned>/report.json on the Mac at plan end');
  const inputs = ['tsconfig.json', 'tsconfig.game.json', 'tsconfig.shards.json'].map(compilerJsonInputs);
  if (!measure) { console.log(JSON.stringify(inputs, null, 2)); return; }
  if (process.platform !== 'darwin') throw new Error('T6 comparison must run on the Mac; no Linux-to-Mac memory comparison');
  const output = resolve(root, args[1] ?? ''), name = relative(resolve(root, 'tmp'), output);
  if (!name || name.startsWith('..') || isAbsolute(name) || !output.endsWith('.json')) throw new Error('Reading output must be an owned JSON path under tmp/');
  mkdirSync(dirname(output), { recursive: true });
  const git = (/** @type {readonly string[]} */ command) => {
    const result = spawnSync('git', command, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0 || result.error !== undefined) throw new Error('Cannot identify reading source');
    return result.stdout.trim();
  };
  const before = git(['rev-parse', 'HEAD']), dirty = git(['status', '--porcelain', '--untracked-files=no']);
  const rows = [];
  for (const command of readingCommands()) {
    const start = performance.now();
    const result = spawnSync('/usr/bin/time', ['-l', command.executable, ...command.args],
      { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 600_000 });
    const log = `${output}.${command.name}.log`;
    writeFileSync(log, `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`);
    rows.push({ name: command.name, status: result.status, signal: result.signal, error: result.error?.message ?? null,
      seconds: (performance.now() - start) / 1000, maxRSSBytes: maximumResidentBytes(result.stderr ?? ''), log: relative(root, log) });
  }
  const after = git(['rev-parse', 'HEAD']), dirtyAfter = git(['status', '--porcelain', '--untracked-files=no']);
  const qualified = before === after && dirty === '' && dirtyAfter === '' && inputs.every(input => input.generated.length === 0)
    && rows.every(row => row.status === 0 && row.error === null && row.maxRSSBytes !== null);
  const rootRow = rows.find(row => row.name === 'root-checkers-4'), lintRow = rows.find(row => row.name === 'full-typed-lint');
  const rootBudget = rootRow?.maxRSSBytes !== null && rootRow?.maxRSSBytes !== undefined && rootRow.maxRSSBytes <= 6_000_000_000;
  const lintBudget = lintRow?.maxRSSBytes !== null && lintRow?.maxRSSBytes !== undefined && lintRow.maxRSSBytes <= 8_000_000_000 && lintRow.seconds <= 15;
  const report = { schema: 'gr12-input-reading/1', source: before, after, dirty, dirtyAfter, inputs, rows, qualified,
    targets: { rootBytes: 6_000_000_000, lintBytes: 8_000_000_000, lintSeconds: 15, rootBudget, lintBudget } };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!qualified || !rootBudget || !lintBudget) process.exitCode = 1;
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
