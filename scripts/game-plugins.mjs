#!/usr/bin/env node
// G307: discover defining plugin modules; the game's exports map remains the only public surface.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'vite';

const ROOT = resolve(import.meta.dirname, '..');
function filesIn(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? filesIn(resolve(root, entry.name)) : /\.[cm]?[jt]sx?$/u.test(entry.name) ? [resolve(root, entry.name)] : []);
}
function specifiers(path, source) {
  const result = new Set();
  const visit = node => {
    if (node === null || typeof node !== 'object') return;
    const literal = value => value?.type === 'Literal' && typeof value.value === 'string' ? value.value : null;
    const value = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'TSImportType'].includes(node.type)
      ? literal(node.source) : node.type === 'TSExternalModuleReference' ? literal(node.expression)
        : node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require' ? literal(node.arguments[0]) : null;
    if (value !== null) result.add(value);
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
  };
  visit(parseSync(path, source).program);
  return [...result];
}

/** Follow current primary runtime closures through SDK facades, stopping at each defining game module. */
export function gamePluginInventory(root = ROOT) {
  const manifest = layer => JSON.parse(readFileSync(resolve(root, `src/${layer}/package.json`), 'utf8'));
  const game = manifest('game'), sdk = manifest('sdk'), sharddev = manifest('sharddev');
  const modules = new Map();
  const target = (layer, specifier) => {
    const entry = (layer === 'game' ? game : layer === 'sharddev' ? sharddev : sdk).exports?.[`.${specifier.slice(`@wildshard/${layer}`.length)}`];
    return typeof entry === 'string' ? resolve(root, `src/${layer}`, entry) : null;
  };
  for (const entry of readdirSync(resolve(root, 'src/shards'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const shard = resolve(root, 'src/shards', entry.name), seen = new Set(), queue = filesIn(resolve(shard, 'runtime'));
    while (queue.length > 0) {
      const path = queue.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      for (const specifier of specifiers(path, readFileSync(path, 'utf8'))) {
        if (specifier.startsWith('@wildshard/engine/game/')) {
          if (!modules.has(specifier)) modules.set(specifier, { specifier, target: target('game', specifier), facades: new Set(), shards: new Set() });
          const row = modules.get(specifier);
          row.shards.add(entry.name);
          if (['src/sdk', 'src/sharddev'].some(dir => path.startsWith(`${resolve(root, dir)}/`))) row.facades.add(relative(root, path));
          continue;
        }
        const base = specifier.startsWith('@wildshard/engine/host/') ? target('sdk', specifier) : specifier.startsWith('@wildshard/sharddev/') ? target('sharddev', specifier)
          : specifier.startsWith('.') ? resolve(dirname(path), specifier) : null;
        if (base === null) continue;
        const next = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`].find(candidate => existsSync(candidate) && /\.[cm]?[jt]sx?$/u.test(candidate));
        if (next !== undefined && (next.startsWith(`${shard}/`) || ['src/sdk', 'src/sharddev'].some(dir => next.startsWith(`${resolve(root, dir)}/`)))) queue.push(next);
      }
    }
  }
  return [...modules.values()].sort((a, b) => a.specifier.localeCompare(b.specifier)).map(row => ({
    specifier: row.specifier, target: row.target === null ? null : relative(root, row.target),
    facades: [...row.facades].sort((a, b) => a.localeCompare(b)), shards: [...row.shards].sort((a, b) => a.localeCompare(b)),
    published: row.target !== null && existsSync(row.target),
  }));
}


/** Report the complete export surface and its consumers. */
export function gamePluginSurface(root = ROOT) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'src/game/package.json'), 'utf8'));
  const entries = Object.entries(manifest.exports).map(([key, target]) => ({
    key, target: typeof target === 'string' ? target : null,
    plugin: key.startsWith('./plugin/'),
    published: typeof target === 'string' && existsSync(resolve(root, 'src/game', target)),
    primaryConsumers: [], otherConsumers: [],
  }));
  const byKey = new Map(entries.map(row => [row.key, row])), unresolved = new Map();
  for (const directory of ['src', 'test', 'scripts', 'api', 'vite']) for (const file of filesIn(resolve(root, directory))) {
    const path = relative(root, file);
    const group = /^src\/shards\/[^/]+\/.+$/u.test(path) ? 'primaryConsumers' : 'otherConsumers';
    for (const specifier of specifiers(file, readFileSync(file, 'utf8'))) {
      if (!specifier.startsWith('@wildshard/engine/game/')) continue;
      const key = `.${specifier.slice('@wildshard/game'.length)}`, row = byKey.get(key);
      if (row !== undefined) row[group].push(path);
      else { if (!unresolved.has(specifier)) unresolved.set(specifier, new Set()); unresolved.get(specifier).add(path); }
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  for (const row of entries) for (const group of ['primaryConsumers', 'otherConsumers']) row[group].sort((a, b) => a.localeCompare(b));
  const pluginExports = entries.filter(row => row.plugin).length;
  return {
    enforcement: 'report-only', limit: 20, totalExports: entries.length, pluginExports,
    withinPluginLimit: pluginExports <= 20, pluginOnly: entries.every(row => row.plugin), entries,
    unresolved: [...unresolved].sort(([a], [b]) => a.localeCompare(b)).map(([specifier, paths]) => ({ specifier, consumers: [...paths].sort((a, b) => a.localeCompare(b)) })),
  };
}

// Removing a legacy importer never grants another exception. The remaining graphical tail retires with DS1.4.
const TEMPORARY_EXPORTS = {
  './systems/looks/surfaceLooks': { target: './systems/looks/surfaceLooks.ts', owner: 'DS1.4', reason: 'Signal material look migration' },
};

/** Enforce defining plugins from a fresh scan, or reuse the caller's unchanged surface report. */
export function checkGamePluginExports(root = ROOT, surface = gamePluginSurface(root)) {
  const failures = [], temporary = [];
  if (!surface.withinPluginLimit) failures.push(`game plugin exports ${surface.pluginExports} exceed ${surface.limit}`);
  for (const row of surface.entries) {
    if (!row.published) failures.push(`${row.key}: export definition missing`);
    if (row.plugin) {
      if (row.target !== `${row.key}.ts`) failures.push(`${row.key}: plugin export must name its defining module`);
      continue;
    }
    const exception = TEMPORARY_EXPORTS[row.key];
    if (exception !== undefined && row.target === exception.target) temporary.push({ key: row.key, ...exception });
    else failures.push(`${row.key}: non-plugin export is not a defining plugin or a named migration tail`);
  }
  for (const row of surface.unresolved) failures.push(`${row.specifier}: unresolved import in ${row.consumers.join(', ')}`);
  return { failures, pluginExports: surface.pluginExports, temporary };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--check')) {
    const result = checkGamePluginExports();
    console.log(JSON.stringify(result, null, 2));
    if (result.failures.length > 0) process.exitCode = 1;
  } else if (process.argv.includes('--report')) {
    const scratch = mkdtempSync(resolve(tmpdir(), 'game-plugin-report-'));
    try {
      const config = resolve(scratch, 'config.json');
      writeFileSync(config, JSON.stringify({ jsPlugins: [resolve(ROOT, 'lint/wildshard-plugin.js')], categories: { correctness: 'off' }, rules: { 'wildshard/shard-game-plugins': 'warn', 'wildshard/generator-imports': 'warn', 'wildshard/shard-engine-imports': 'warn', 'wildshard/sdk-no-facade': 'warn' } }));
      const result = spawnSync(process.execPath, [resolve(ROOT, 'node_modules/oxlint/bin/oxlint'), '-c', config, ...(process.argv.includes('--json') ? ['-f', 'json'] : []), 'src/shards', 'src/sdk', 'src/sharddev'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('Plugin report failed to execute');
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  } else console.log(JSON.stringify({ enforcement: 'report-only', surface: gamePluginSurface(), modules: gamePluginInventory() }, null, 2));
}
