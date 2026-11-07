#!/usr/bin/env node
// SF6b: deterministic outputs in an immutable export; never read the shared working tree.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apiSurface, undocumented } from './gen-api.mjs';
import { compareEdges, graph } from './check-graph.mjs';
import { generatedIncreases, replaceDebt, verifyIncreaseTrailers } from './generated-policy.mjs';

const sorted = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)])) : value;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const read = (root, file) => readFileSync(resolve(root, file), 'utf8');
const data = (root, file) => JSON.parse(read(root, file));
function run(root, command, args) {
  const out = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (out.error) throw out.error;
  if (out.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${out.stderr.length > 0 ? out.stderr : out.stdout}`);
  return out.stdout;
}
/**
 * Compute every committed generated output, while leaving policy inputs and manual documentation alone. SF74 W13 (G281):
 * the API surface, docs/api/ and the export index are build outputs (`pnpm gen`, scripts/gen-api.mjs), not here; only
 * the shrink-only baselines (layer-edges and ratchet debt) stay committed.
 */
export function generatedFiles(root, apiOver = null) {
  const files = [];
  const scan = (dir) => {
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(file);
      else if (/\.[cm]?[jt]sx?$/u.test(file) && !file.endsWith('.d.ts')) files.push(file);
    }
  };
  scan('src');
  const { edges, violations } = graph(files.sort((a, b) => a.localeCompare(b)), (file) => read(root, file), (file) => existsSync(resolve(root, file)));
  const failures = [...violations, ...compareEdges(edges, edges).failures];
  const surface = apiSurface(root), ceiling = data(root, 'lint/api-undocumented.json').max;
  if (undocumented(surface) > ceiling) (apiOver ?? ((row) => failures.push(row)))(`Undocumented API ${undocumented(surface)} exceeds ${ceiling}`);
  if (failures.length > 0) throw new Error(failures.join('\n'));
  const ratchet = replaceDebt(data(root, 'lint/ratchet.json'), JSON.parse(run(root, process.execPath, ['lint/ratchet.mjs', '--measure'])));
  const outputs = {
    'lint/layer-edges.json': json({ about: 'Generated cross-layer import counts; permitted downward counts are report-only.', edges: sorted(edges) }),
    'lint/ratchet.json': json(sorted(ratchet)),
  };
  return { outputs, measurement: { edges, ratchet } };
}
/**
 * Refuse stale bytes and unlisted measured increases, including the docs Vercel excludes.
 * The serialized pusher may reuse a candidate it just measured on this same unchanged committed export.
 */
export function checkGenerated(root, predecessor, message, candidate = generatedFiles(root)) {
  const stale = Object.entries(candidate.outputs).filter(([file, text]) => (existsSync(resolve(root, file)) ? read(root, file) : '') !== text).map(([file]) => file);
  if (stale.length > 0) throw new Error(`Stale or hand-edited generated files: ${stale.join(', ')}`);
  verifyIncreaseTrailers(generatedIncreases(predecessor, candidate.measurement), message);
  return candidate;
}
/**
 * The pusher's reseed: today's counts, or a refusal. Ratchets only fall, so a rise stops here and goes through
 * checkGenerated's approval trailers. A dirty tree is refused too: it would record another lane's unfinished work.
 * AG21's API ceiling only warns here: it is breached already, and a breach must not stop the debt that did fall.
 */
export function reseed(root) {
  // `pnpm gen` rewrites its own outputs in a clean export too. They count no debt, so they aren't anyone's work.
  const dirty = run(root, 'git', ['status', '--porcelain']).split('\n').filter((line) => line !== '' && !/(?:\.generated\.[^/]+|^budgets\/ceiling-sources\.json)$/u.test(line.slice(3)));
  if (dirty.length > 0) throw new Error(`Refusing --write on a dirty tree; run it in a clean export:\n${dirty.join('\n')}`);
  const candidate = generatedFiles(root, (row) => console.warn(`generated-files: ${row}`));
  const recorded = { edges: data(root, 'lint/layer-edges.json').edges, ratchet: data(root, 'lint/ratchet.json') };
  const rises = generatedIncreases(recorded, candidate.measurement);
  if (rises.length > 0) throw new Error(`Refusing a rise:\n${rises.map((row) => JSON.stringify(row)).join('\n')}`);
  return candidate;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const root = resolve(import.meta.dirname, '..');
    if (process.argv[2] === '--check') {
      const previous = data(resolve(process.argv[3]), 'measurement.json');
      checkGenerated(root, previous, readFileSync(resolve(process.argv[4]), 'utf8'));
      console.log('generated-files: every generated output and exact increase receipt passed');
    } else if (process.argv[2] === '--write') {
      const { outputs } = reseed(root);
      for (const [file, text] of Object.entries(outputs)) { mkdirSync(resolve(root, file, '..'), { recursive: true }); writeFileSync(resolve(root, file), text); }
    } else throw new Error('Use --write inside an immutable export, or --check <predecessor-dir> <commit-message-file>');
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
