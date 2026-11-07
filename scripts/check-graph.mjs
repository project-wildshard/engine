#!/usr/bin/env node
// E362 AG7 (project/archive/2026-10-03-arch-guards.md): the import graph between layers and shards, in one parse of src.
//   node scripts/check-graph.mjs            check: a new layer pair, a rising pair count, a two-way pair (a cycle
//                                            across two layers or two shards), a shard file reached from outside
//                                            the shard other than as the plan allows, fails
//   node scripts/check-graph.mjs --update   record today's counts in lint/layer-edges.json (they may only fall)
//   node scripts/check-graph.mjs --paths <file…>   pre-commit: the edges those files add against HEAD's copies
// A shard is reached from outside only as src/client/app/shards.generated.ts → its manifest (static), and its
// plugin.ts only by `import()` from its own manifest. The layer rule (`wildshard/layer`) says which way imports
// point; this counts how much crosses, so a new crossing is a visible, reviewed change.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSync } from 'vite';
import { exportedPath } from '../lint/layer-exports.mjs';
import { checkSimRuntime } from './sim-in-runtime.mjs';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const EDGES_FILE = 'lint/layer-edges.json';
const GENERATED_TABLE = 'src/client/app/shards.generated.ts';
const SOURCE = /\.[cm]?[jt]sx?$/u;

/** HEAD resolves tracked modules plus ignored build outputs, never ordinary untracked source.
 * @param {string} path
 * @param {ReadonlySet<string>} tracked
 * @param {(path:string)=>boolean} diskExists
 */
export function headModuleExists(path, tracked, diskExists) {
  return tracked.has(path) || (/\.generated\.[cm]?[jt]sx?$/u.test(path) && diskExists(path));
}

/** the layer a src path belongs to: engine, game, sdk, commons, shards/<slug>, root */
export function layerOf(path) {
  const m = /^src\/(engine|game|sdk|sharddev|commons)\//u.exec(path);
  if (m) return m[1];
  const s = /^src\/shards\/([^/]+)\//u.exec(path);
  if (s) return `shards/${s[1]}`;
  return /^src\/[^/]+$/u.test(path) ? 'root' : null;
}

/** a specifier → a repo path under src (or null for a package, an asset, or anything outside src) */
export function resolveSpecifier(from, spec, exists) {
  let base;
  const pkg = /^@wildshard\/(engine|format|game|sdk|sharddev|commons)(?:\/(.+))?$/u.exec(spec); // E432: the layers' packages; format resolves only where `exists` maps it
  // the #aliases are how commits before E432 spelled the same edges (the rise check reads the parent commit's graph)
  const legacy = /^#(engine|game|kit|shards)(?:\/(.+))?$/u.exec(spec);
  if (pkg) { const [, layer, sub = 'index'] = pkg; base = `src/${layer}/${sub}`; }
  else if (legacy) { const [, layer, sub = 'index'] = legacy; base = `src/${layer}/${sub}`; }
  else if (spec.startsWith('.')) base = relative(ROOT, resolve(ROOT, dirname(from), spec)).replaceAll('\\', '/');
  else return null;
  if (!base.startsWith('src/')) return null;
  const exported = pkg ? exportedPath(pkg[1], pkg[2]) : null; // J122: a sorted file's export names its folder; a past commit's tree may not hold it
  if (exported !== null && SOURCE.test(exported) && exists(exported)) return exported;
  if (/\.(?:css|jpg|jpeg|png|webp|svg|json|glsl|wgsl|txt)(?:\?.*)?$/u.test(base)) return null;
  const stripped = base.replace(/\.js$/u, '');
  for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}.mjs`, `${stripped}.js`, `${stripped}/index.ts`]) if (exists(candidate) && SOURCE.test(candidate)) return candidate;
  return null;
}

/** every import of one file: { to, dynamic } */
export function importsOf(path, source, exists) {
  const parsed = parseSync(path, source);
  const out = [];
  const add = (spec, dynamic) => { const to = resolveSpecifier(path, spec, exists); if (to !== null) out.push({ to, dynamic }); };
  for (const i of parsed.module.staticImports) add(i.moduleRequest.value, false);
  for (const e of parsed.module.staticExports) for (const entry of e.entries) if (entry.moduleRequest) add(entry.moduleRequest.value, false);
  for (const d of parsed.module.dynamicImports) {
    const text = source.slice(d.moduleRequest.start, d.moduleRequest.end).trim();
    const m = /^(['"`])([^'"`$]+)\1$/u.exec(text);
    if (m) add(m[2], true);
  }
  // one edge per (file, target, kind): `import type` + `import` from the same module is one dependency
  const seen = new Set();
  return out.filter((e) => { const k = `${e.to}|${e.dynamic}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** the shard-reach rule: what may import a shard's files from outside that shard */
export function reachViolation(from, to, dynamic) {
  const toLayer = layerOf(to), fromLayer = layerOf(from);
  if (!toLayer?.startsWith('shards/') || toLayer === fromLayer) {
    if (toLayer?.startsWith('shards/') && to.endsWith('/plugin.ts') && to.split('/').length === 4 && !dynamic && from.endsWith('/manifest.ts')) return `${from} imports ${to} statically: a plugin loads only by import() from its manifest`;
    return null;
  }
  const slug = toLayer.slice('shards/'.length);
  // SF88g: a source folder that emits several products has one discovery module per output (discovery.<slug>.generated.ts)
  if (from === GENERATED_TABLE && (to === `src/shards/${slug}/manifest.ts` || /^discovery(?:\.[a-z0-9-]+)?\.generated\.ts$/u.test(to.slice(`src/shards/${slug}/`.length)))) return null;
  return `${from} reaches into ${to}: only ${GENERATED_TABLE} imports a shard (its manifest), and a plugin loads only by import() from its own manifest`;
}

function sourceFiles() {
  const files = [];
  const scan = (dir) => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(path);
      else if (SOURCE.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path);
    }
  };
  scan('src');
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Jake, G288 (2026-10-09): a shard's downward imports (shard → engine / game / sdk / commons) are standing-approved
 * (.git/generated-approval.json), so they are not counted in lint/layer-edges.json: their rises made ~80 regeneration
 * commits a day and stalled the pusher on receipts. Direction stays enforced where it always was: the `wildshard/layer`
 * and `shard-sandbox` lint rules refuse upward imports, the reach check below refuses one shard reaching into another,
 * and the two-way (cycle) check still sees every edge. Every other pair (game → engine, sdk → game, root → …) is counted.
 */
export const APPROVED_DOWNWARD = /^shards\/[^ ]+ → (engine|game|sdk|sharddev|commons)$/u;
/** Counts on permitted downward directions are informational (Jake, G358).
 * Direction, shard reach and cycles remain architecture errors.
 * @param {string} key */
export function allowedGraphDirection(key) {
  const order = ['engine', 'game', 'sdk', 'sharddev', 'commons'];
  const [from, to] = key.split(' → ');
  const rank = layer => layer === 'root' ? 6 : (layer ?? '').startsWith('shards/') ? 5 : order.indexOf(layer);
  return rank(from) >= 0 && rank(to) >= 0 && rank(from) > rank(to);
}
/** the counts of cross-layer edges: { 'game → engine': 887, … } (minus APPROVED_DOWNWARD) and the reach violations */
export function graph(files, read, exists) {
  const edges = {}, hardEdges = {}, violations = [];
  for (const from of files) {
    const fromLayer = layerOf(from);
    if (fromLayer === null) continue;
    for (const { to, dynamic } of importsOf(from, read(from), exists)) {
      const toLayer = layerOf(to);
      if (toLayer === null) continue;
      const v = reachViolation(from, to, dynamic);
      if (v !== null) violations.push(v);
      // the generated table → each manifest is the one sanctioned way the game reaches a shard: not a counted crossing
      if (toLayer === fromLayer || (from === GENERATED_TABLE && reachViolation(from, to, dynamic) === null && toLayer.startsWith('shards/'))) continue;
      const key = `${fromLayer} → ${toLayer}`;
      hardEdges[key] = (hardEdges[key] ?? 0) + 1;
      if (!APPROVED_DOWNWARD.test(key)) edges[key] = (edges[key] ?? 0) + 1;
    }
  }
  violations.push(...compareEdges(hardEdges, hardEdges).failures);
  return { edges, violations };
}

/** the failures of `current` against the recorded counts, and the counts that fell (so --update can lower them) */
export function compareEdges(recorded, current) {
  const failures = [], fell = [];
  for (const [key, n] of Object.entries(current)) {
    const was = recorded[key];
    if (!allowedGraphDirection(key)) failures.push(`forbidden layer direction: ${key}`);
    else if (!Number.isSafeInteger(n) || n < 0) failures.push(`invalid graph count: ${key}`);
    else if (was === undefined || n > was) fell.push(`${key} count ${was ?? 0} → ${n} (report-only)`);
    else if (n < was) fell.push(`${key} fell ${was} → ${n}`);
  }
  for (const key of Object.keys(recorded)) if (current[key] === undefined) fell.push(`${key} is gone`);
  for (const key of Object.keys(current)) {
    const [a, b] = key.split(' → '), back = `${b} → ${a}`;
    if (a < b && current[back] !== undefined) failures.push(`cycle across ${a} and ${b}: both ${key} and ${back}`);
  }
  return { failures, fell };
}

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function main(input) {
  const simFailures=checkSimRuntime(ROOT);
  if(simFailures.length>0){console.error(`check-graph (G453):\n  ${simFailures.join('\n  ')}`);return 1;}
  const sourceOnly = input.includes('--source-only');
  const argv = input.filter((arg) => arg !== '--source-only');
  const exists = (p) => existsSync(resolve(ROOT, p));
  if (argv[0] === '--paths') {
    // pre-commit: for the staged files only, the edges they add against HEAD's copy (counts may only fall)
    const paths = argv.slice(1).filter((p) => /^src\/.*\.[cm]?[jt]sx?$/u.test(p) && !p.endsWith('.d.ts'));
    const head = (p) => { try { return execFileSync('git', ['show', `HEAD:${p}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch { return ''; } };
    const staged = (p) => { try { return execFileSync('git', ['show', `:${p}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }); } catch { return ''; } };
    const present = paths.filter((p) => staged(p) !== '');
    // HEAD's graph resolves against HEAD's files (a commit that deletes a module HEAD imported must not read as HEAD
    // having no such edge, E434)
    const headFiles = new Set(execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', 'src'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n'));
    // and a file the commit deletes still counts in HEAD's graph (its edges leave with it)
    const deleted = execFileSync('git', ['diff', '--cached', '--no-renames', '--name-only', '--diff-filter=D', '--', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n')
      .filter((p) => /^src\/.*\.[cm]?[jt]sx?$/u.test(p) && !p.endsWith('.d.ts') && !paths.includes(p));
    const stagedFiles = new Set(execFileSync('git', ['ls-files', '--cached', '--', 'src'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n'));
    const now = graph(present, staged, (p) => headModuleExists(p, stagedFiles, exists)), before = graph([...paths, ...deleted].filter((p) => head(p) !== ''), head, (p) => headModuleExists(p, headFiles, exists));
    const failures = [];
    // a rise the same commit records in lint/layer-edges.json (`--update`, a reviewed crossing) passes
    const recorded = (read) => { try { return JSON.parse(read(EDGES_FILE)).edges ?? {}; } catch { return {}; } };
    const headRec = recorded(head), stagedRec = recorded(staged);
    for (const [key, n] of Object.entries(now.edges)) {
      const rise = n - (before.edges[key] ?? 0), allowed = (stagedRec[key] ?? 0) - (headRec[key] ?? 0);
      if (rise > 0 && allowedGraphDirection(key)) console.warn(`check-graph: ${key} rises by ${rise} (report-only)`);
      else if (rise > 0 && sourceOnly) failures.push(`forbidden layer direction: ${key}`);
      else if (rise > 0 && rise > allowed) failures.push(`${key} rises by ${rise} in this commit (record a reviewed crossing with node scripts/check-graph.mjs --update)`);
    }
    const combined = { ...headRec, ...now.edges };
    failures.push(...compareEdges(combined, combined).failures);
    const old = new Set(before.violations);
    failures.push(...now.violations.filter((v) => !old.has(v)));
    if (failures.length > 0) { console.error(`check-graph (AG7):\n  ${failures.join('\n  ')}`); return 1; }
    return 0;
  }
  const { edges, violations } = graph(sourceFiles(), (p) => readFileSync(resolve(ROOT, p), 'utf8'), exists);
  const file = resolve(ROOT, EDGES_FILE);
  if (argv[0] === '--update') {
    writeFileSync(file, `${JSON.stringify({ about: 'E362 AG7: cross-layer import counts (scripts/check-graph.mjs). A new pair or a rising count fails; lower with --update.', edges: sorted(edges) }, null, 2)}\n`);
    console.log(`check-graph: recorded ${Object.keys(edges).length} layer pairs in ${EDGES_FILE}`);
    if (violations.length > 0) { console.error(`check-graph: shard reach violations:\n  ${violations.join('\n  ')}`); return 1; }
    return 0;
  }
  const recorded = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).edges : {};
  const { failures, fell } = compareEdges(recorded, edges);
  failures.push(...violations);
  for (const f of fell) console.warn(`check-graph: ${f}; lower it: node scripts/check-graph.mjs --update`);
  if (failures.length > 0) { console.error(`check-graph (AG7) failed:\n  ${failures.join('\n  ')}`); return 1; }
  console.log(`check-graph: ${Object.keys(edges).length} layer pairs, none new or rising; no shard reach`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
