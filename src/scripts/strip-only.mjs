#!/usr/bin/env node
// Meta QA 11-25 row 25 (J505): Node runs engine TypeScript strip-only (`node src/scripts/pins.ts`, the cook worker, the hooks'
// node tests), and strip-only Node cannot run a parameter property, an enum or a namespace. fc0832b52 put a parameter
// property in the cook and held engine main red for 82 minutes; the lint override covered only src/*/engine and src/cook.
// This walks the real import closure of every file Node runs directly (scripts, hooks, lint) and asks Node's own
// stripper about each TypeScript file in it, so a file is judged exactly when Node would load it, wherever it lives.
// Meta QA 11-25 row 42: Node 26 dropped its transform-types flag ("bad option"), so nothing here runs with it any more.
// Every file Node runs is strip-only, the tools, proofs and workers that once took the flag included, and a file that
// still passes the flag is refused (the stored copies of old CI files under test/fixtures excepted).
//
//   node src/scripts/strip-only.mjs          exits 1 naming each file Node would refuse, and the entry that reaches it
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Files Node runs directly here: tooling under these roots, never declarations. */
export const ENTRY = /^(?:src\/scripts|\.githooks|\.agents\/hooks|lint)\/.+\.(?:mjs|js|ts|mts)$/u;
const DECLARATION = /\.d\.[mc]?ts$/u;
const TYPESCRIPT = /\.(?:ts|mts|cts)$/u;
// A static import or re-export opens its line; a dynamic import with a literal may sit anywhere on a line, but not after
// a backtick (authored-manifest.mjs writes generated code that imports).
const STATIC = /^\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s+from\s*)?['"]([^'"\n]+)['"]/gmu;
const DYNAMIC = /^[^`\n]*?\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/gmu;
/** Proofs, fixtures and workers Node runs directly: a test spawns them, or a worker thread starts them by URL. */
export const RUN = /^(?:test\/(?:fixtures|proof|manual|ci)\/.+|test\/[^/]+\.proof|src\/test\/.+|src\/server\/host\/bake\/headlessWorker)\.(?:mjs|js|ts|mts)$/u;
// Spelled in two parts so this file does not name itself.
const FLAG = ['--experimental', 'transform-types'].join('-');
/** Stored copies of old CI files, kept byte for byte. */
const OLD_COPY = /^test\/fixtures\/ci-native-cache-v\d+\.yml$/u;

/** The module specifiers a source loads at run time (type-only imports are already gone from stripped TypeScript).
 * @param {string} source @returns {string[]} */
export function specifiers(source) {
  return [...[...source.matchAll(STATIC)].map(match => match[1]), ...[...source.matchAll(DYNAMIC)].map(match => match[1])];
}

/** Files that still pass Node's removed transform flag.
 * @param {{ path: string, text: string }[]} files @returns {string[]} */
export function flagUsers(files) {
  return files.filter(({ path, text }) => !OLD_COPY.test(path) && text.includes(FLAG)).map(({ path }) => path).sort();
}

/**
 * Every TypeScript file in the entries' import closure that strip-only Node would refuse.
 * @param {string} root @param {string[]} entries repo-relative
 * @returns {{ file: string, entry: string, error: string }[]}
 */
export function stripOnlyRefusals(root, entries) {
  const seen = new Set(), refusals = [];
  const stack = entries.filter(file => !DECLARATION.test(file)).map(file => ({ path: resolve(root, file), entry: file }));
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || seen.has(next.path)) continue;
    const { path, entry } = next;
    seen.add(path);
    let source = readFileSync(path, 'utf8');
    if (TYPESCRIPT.test(path)) {
      try { source = stripTypeScriptTypes(source); } catch (error) {
        refusals.push({ file: relative(root, path), entry, error: String(error instanceof Error ? error.message : error).split('\n')[0] });
        continue;
      }
    }
    const require = createRequire(pathToFileURL(path));
    for (const specifier of specifiers(source)) {
      if (specifier.startsWith('node:')) continue;
      let target = '';
      try { target = require.resolve(specifier); } catch { continue; }   // a bare package, a build alias
      if (!target.startsWith(`${root}/`) || target.includes('/node_modules/') || !/\.(?:mjs|js|ts|mts|cts)$/u.test(target)) continue;
      if (!DECLARATION.test(target) && existsSync(target)) stack.push({ path: target, entry });
    }
  }
  return refusals.sort((a, b) => a.file.localeCompare(b.file));
}

/** The files of a checkout Node runs strip-only, and the files that still pass the removed flag.
 * @param {string} root @returns {{ entries: string[], flagged: string[] }} */
export function trackedEntries(root) {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(file => file !== '' && existsSync(resolve(root, file)));
  const texts = files.filter(file => /\.(?:mjs|js|ts|mts|json|ya?ml|sh|md)$/u.test(file) && !file.startsWith('project/'))
    .map(path => ({ path, text: readFileSync(resolve(root, path), 'utf8') }));
  return { entries: files.filter(file => (ENTRY.test(file) || RUN.test(file)) && !DECLARATION.test(file)), flagged: flagUsers(texts) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = process.cwd(), { entries, flagged } = trackedEntries(root), refusals = stripOnlyRefusals(root, entries);
  for (const { file, entry, error } of refusals) console.error(`strip-only: ${file} (reached from ${entry}): ${error}`);
  for (const file of flagged) console.error(`strip-only: ${file} passes ${FLAG}, which Node 26 refuses; drop it (Node strips types itself)`);
  if (flagged.length > 0 && refusals.length === 0) process.exit(1);
  if (refusals.length > 0) {
    console.error('Node runs these strip-only: declare the field and assign it in the constructor (no parameter property, enum or namespace).');
    process.exit(1);
  }
  console.log('strip-only: every TypeScript file Node runs here is erasable');
}
