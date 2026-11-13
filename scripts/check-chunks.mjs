#!/usr/bin/env node
// E357 L7: check actual module ownership and lazy isolation, not chunk filenames.
// Exact grouped layout is deliberately not enforced: B69's three grouping attempts broke boot,
// and L7's final try failed all seven slugs in both tiers (undefined runtime_exports).
// Evidence: progress/normalization/l7/group-failure.json. Grouping stays disabled; shard code
// may span several lazy chunks, but startup must remain clean and shard owners cannot mix.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Also runs inside the actual build, before a preview or deploy can publish. */
export function gridSessionBudgetErrors(modules, budgets) {
  const errors = [];
  for (const [file, row] of Object.entries(modules)) if (row.moduleIds.includes('src/client/game/grid/session.ts')) {
    for (const [unit, field] of [['raw', 'rawBytes'], ['gzip', 'gzBytes']]) {
      const cap = budgets[`js/grid-session/${unit}`];
      if (!Number.isSafeInteger(cap) || cap <= 0) errors.push(`missing grid session ${unit} ceiling`);
      else if (!Number.isSafeInteger(row[field]) || row[field] < 0) errors.push(`missing grid session ${unit} bytes (${file})`);
      else if (row[field] > cap) errors.push(`grid session ${unit} ${row[field]} exceeds ${cap} (${file})`);
    }
  }
  return errors;
}

const titleRoots = ['src/client/app/entry.ts', 'src/client/engine/ui/StartTitle.ts', 'src/client/game/mainMenu.ts', 'src/client/game/grid/pageEntry.ts', 'src/client/game/travel/travel.ts'];
const titleFormat = new Set(['accent.ts', 'admissionLimits.ts', 'builtIndexes.ts', 'contentBounds.ts', 'outputDownload.ts']);
/** One entry's static closure (its roots' chunks and their static imports, a shared chunk counted once) against its
 *  raw / gzip ceilings in lint/ratchet.json budgets (js/<label>/raw and js/<label>/gzip) and a forbidden-module rule. */
function closureBudgetErrors(modules, budgets, label, roots, forbidden) {
  const entries = Object.entries(modules), clean = id => id.replaceAll('\\', '/').split('?')[0];
  if (!Object.hasOwn(budgets, `js/${label}/gzip`) && !entries.some(([, row]) => row.moduleIds.some(id => clean(id) === roots[0]))) return [];
  const errors = [], selected = new Set();
  function visit(file) {
    if (selected.has(file)) return;
    selected.add(file);
    const row = modules[file];
    if (row === undefined) { errors.push(`missing ${label} chunk ${file}`); return; }
    if (!Array.isArray(row.imports)) { errors.push(`missing ${label} static imports (${file})`); return; }
    for (const dependency of row.imports) visit(dependency);
  }
  for (const source of roots) {
    const found = entries.filter(([, row]) => row.moduleIds.some(id => clean(id) === source));
    if (found.length === 0) errors.push(`missing ${label} root ${source}`);
    for (const [file] of found) visit(file);
  }
  for (const file of selected) for (const raw of modules[file]?.moduleIds ?? []) {
    const id = clean(raw);
    if (forbidden(id)) errors.push(`forbidden ${label} module ${id} (${file})`);
  }
  for (const [unit, field] of [['raw', 'rawBytes'], ['gzip', 'gzBytes']]) {
    const cap = budgets[`js/${label}/${unit}`]; let total = 0;
    if (!Number.isSafeInteger(cap) || cap <= 0) { errors.push(`missing ${label} ${unit} ceiling`); continue; }
    for (const file of selected) {
      const bytes = modules[file]?.[field];
      if (!Number.isSafeInteger(bytes) || bytes < 0) errors.push(`missing ${label} ${unit} bytes (${file})`); else total += bytes;
    }
    if (total > cap) errors.push(`${label} ${unit} ${total} exceeds ${cap}`);
  }
  return errors;
}
/** Static dependencies of the original public title's explicit dynamic roots.
 * Count shared chunks once; optional settings and gameplay stay outside.
 * Ceilings 160 KB gzip / 500 KB raw (J324, Jake 2026-11-13: "A 1 megabyte title page is fine"; was 110 KB / 350 KB). */
export function titleClosureBudgetErrors(modules, budgets) {
  // C3: the title's rows are data in its document, so the cold title loads no generated module
  return closureBudgetErrors(modules, budgets, 'title', titleRoots, id => /node_modules\/(?:three|@dimforge\/rapier[^/]*)(?:\/|$)/u.test(id)
    || /^src\/shards\/.*\.[cm]?[jt]sx?$/u.test(id) || /\.generated(?:\.|$)/u.test(id)
    || /^src\/(?:client|cook|server|shared)\/engine\/(?:explore|calibrate)\//u.test(id)
    || /\/@wildshard\/format\/src\/format\/.*\.ts$/u.test(id) && !titleFormat.has(id.slice(id.lastIndexOf('/') + 1)));
}
/** js-payload J10: the shard session entry's static closure (what every shardfile or grid entry loads before its shard):
 *  gzip / raw ceilings, and no shard folder's code (each shard, LEGACY included, stays behind its own dynamic root). */
export function sessionClosureBudgetErrors(modules, budgets) {
  return closureBudgetErrors(modules, budgets, 'session', ['src/client/game/session/session.ts'], id => /^src\/shards\/.*\.[cm]?[jt]sx?$/u.test(id));
}

export function checkChunks(manifest, modules, closures, budgets = {}) {
  const errors = [];
  // SF16 keeps picker metadata; every authored template gameplay module is data loaded from its shardfile.
  const templateMetadata = new Set(['manifest.ts', 'manifest.json', 'discovery.generated.ts', 'boot/bindings.ts', 'budgets.ts', 'budgetCeilings.ts', 'data/budgets.ts', 'data/budgetCeilings.ts', 'data/spawn.ts', 'explore/art.ts'].map((path) => `src/shards/_template/${path}`));
  const allowed = new Set(Object.values(closures).flat());
  const cold = new Set();
  function reach(key) {
    const row = manifest[key];
    if (!row) { errors.push(`manifest has no chunk ${key}`); return; }
    if (cold.has(row.file)) return;
    cold.add(row.file);
    for (const next of row.imports ?? []) reach(next);
  }
  const entry = Object.entries(manifest).find(([key, row]) => row.isEntry && (key === 'index.html' || key === 'src/client/app/entry.ts'));
  if (!entry) errors.push('manifest has no web entry');
  else reach(entry[0]);
  // E188: a dropped Three download can only retry after this small entry graph has evaluated.
  const beforeEntry = new Set(cold);
  for (const file of beforeEntry) for (const raw of modules[file]?.moduleIds ?? []) {
    const id = raw.replaceAll('\\', '/').split('?')[0];
    if (id === 'src/client/engine/app/runtime.ts' || /node_modules\/three\/(?:build|src)\//.test(id)) errors.push(`${id} is in the pre-entry static graph (${file}); module downloads cannot reach retried()`);
  }

  for (const [key, row] of Object.entries(manifest)) if (row.src === 'src/client/app/main.ts' || key === 'src/client/app/main.ts' || row.src === 'src/client/engine/boot/runtime.ts' || modules[row.file]?.name === 'three' || modules[row.file]?.name === 'engine') reach(key);
  const owners = new Map();
  for (const [file, row] of Object.entries(modules)) {
    for (const raw of row.moduleIds) {
      const id = raw.replaceAll('\\', '/').split('?')[0];
      const match = /^src\/shards\/([^/]+)\//.exec(id);
      if (match?.[1] === '_template' && !templateMetadata.has(id)) errors.push(`${id} is template gameplay code in chunk ${file}: SF16 requires no template runtime chunk`);
      // SHARD-PLATFORM SP5: a shard's generators run at bake time; their code never ships in any chunk
      if (match && /^src\/shards\/[^/]+\/(?:generators|bake)\//.test(id)) errors.push(`${id} is a generator in chunk ${file}: generators run at bake time and never ship`);
      if (!match || allowed.has(id)) continue;
      const slug = match[1];
      if (cold.has(file)) errors.push(`${id} is in cold-boot chunk ${file}`);
      if (!owners.has(file)) owners.set(file, new Set());
      owners.get(file).add(slug);
    }
  }
  for (const [file, slugs] of owners) if (slugs.size > 1) errors.push(`${file} mixes shard owners ${[...slugs].join(', ')}`);
  // The bundler may split a shard internally; every static or dynamic chunk edge must preserve its owner.
  for (const [key, row] of Object.entries(manifest)) {
    const sourceOwners = owners.get(row.file);
    if (!sourceOwners) continue;
    for (const next of [...row.imports ?? [], ...row.dynamicImports ?? []]) {
      const target = manifest[next];
      if (!target) { errors.push(`${key} imports missing chunk ${next}`); continue; }
      const targetOwners = owners.get(target.file);
      if (targetOwners) for (const slug of targetOwners) if (!sourceOwners.has(slug)) errors.push(`${row.file} imports another shard (${slug}) through ${target.file}`);
    }
  }
  // Fail closed if the report was missing, incomplete or from a different build.
  for (const row of Object.values(manifest)) if ((row.name !== undefined || row.isEntry || row.isDynamicEntry || cold.has(row.file)) && row.file.endsWith('.js') && !modules[row.file]) errors.push(`missing module report for ${row.file}`);
  if (Object.keys(modules).length === 0) errors.push('empty chunk module report');
  errors.push(...gridSessionBudgetErrors(modules, budgets), ...titleClosureBudgetErrors(modules, budgets), ...sessionClosureBudgetErrors(modules, budgets));
  return { errors, table: Object.entries(modules).map(([file, row]) => ({ file, name: row.name, gzBytes: row.gzBytes, modules: row.moduleIds.length })) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const dist = resolve(process.argv[2] ?? 'dist');
    const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
    const result = checkChunks(json(resolve(dist, '.vite/manifest.json')), json(resolve(dist, '.vite/chunk-modules.json')), json(resolve('src/server/game/shard/manifest-closure.generated.json')), json(resolve('lint/ratchet.json')).budgets);
    for (const row of result.table) console.log(`${row.name.padEnd(32)} ${(row.gzBytes / 1024).toFixed(1).padStart(8)} gz KB  ${String(row.modules).padStart(4)} modules  ${row.file}`);
    for (const error of result.errors) console.error(`check-chunks: ${error}`);
    if (result.errors.length > 0) process.exitCode = 1;
  } catch (error) { console.error(`check-chunks: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
