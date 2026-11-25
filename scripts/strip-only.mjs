#!/usr/bin/env node
// Meta QA 11-25 row 25 (J505): Node runs engine TypeScript strip-only (`node scripts/pins.ts`, the cook worker, the hooks'
// node tests), and strip-only Node cannot run a parameter property, an enum or a namespace. fc0832b52 put a parameter
// property in the cook and held engine main red for 82 minutes; the lint override covered only src/*/engine and src/cook.
// This walks the real import closure of every file Node runs directly (scripts, hooks, lint) and asks Node's own
// stripper about each TypeScript file in it, so a file is judged exactly when Node would load it, wherever it lives.
// A file some command runs with `--experimental-transform-types` (named on that command's line) is not strip-only.
//
//   node scripts/strip-only.mjs          exits 1 naming each file Node would refuse, and the entry that reaches it
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Files Node runs directly here: tooling under these roots, never declarations. */
export const ENTRY = /^(?:scripts|\.githooks|\.agents\/hooks|lint|kit\/scripts)\/.+\.(?:mjs|js|ts|mts)$/u;
const DECLARATION = /\.d\.[mc]?ts$/u;
const TYPESCRIPT = /\.(?:ts|mts|cts)$/u;
// A static import or re-export opens its line; a dynamic import with a literal may sit anywhere on a line, but not after
// a backtick (authored-manifest.mjs writes generated code that imports).
const STATIC = /^\s*(?:import|export)\s*(?:[\w*{}\s,$]+?\s+from\s*)?['"]([^'"\n]+)['"]/gmu;
const DYNAMIC = /^[^`\n]*?\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/gmu;
const TRANSFORM_LINE = /--experimental-transform-types/u;
const TOOL_PATH = /(?:\.\/)?((?:scripts|lint|\.githooks|kit\/scripts)\/[\w./-]+\.(?:mjs|js|ts|mts))/gu;

/** The module specifiers a source loads at run time (type-only imports are already gone from stripped TypeScript).
 * @param {string} source @returns {string[]} */
export function specifiers(source) {
  return [...[...source.matchAll(STATIC)].map(match => match[1]), ...[...source.matchAll(DYNAMIC)].map(match => match[1])];
}

/** Tool files some command runs with `--experimental-transform-types`: named on such a line in any file.
 * @param {{ path: string, text: string }[]} files */
export function transformEntries(files) {
  const out = new Set();
  for (const { text } of files) {
    const lines = text.split('\n');
    // the command and the line after it (a folded YAML `run: >-` names the script on the next line)
    lines.forEach((line, at) => { if (TRANSFORM_LINE.test(line)) for (const match of `${line}\n${lines[at + 1] ?? ''}`.matchAll(TOOL_PATH)) out.add(match[1]); });
  }
  return out;
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

/** The tool files of a checkout Node runs strip-only: tracked entries, less those a command runs with transform-types.
 * @param {string} root */
export function trackedEntries(root) {
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const texts = files.filter(file => /\.(?:mjs|js|ts|mts|json|ya?ml|sh)$/u.test(file) && !file.startsWith('project/') && existsSync(resolve(root, file)))
    .map(path => ({ path, text: readFileSync(resolve(root, path), 'utf8') }));
  const transformed = transformEntries(texts);
  return files.filter(file => ENTRY.test(file) && !transformed.has(file));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = process.cwd(), refusals = stripOnlyRefusals(root, trackedEntries(root));
  for (const { file, entry, error } of refusals) console.error(`strip-only: ${file} (reached from ${entry}): ${error}`);
  if (refusals.length > 0) {
    console.error('Node runs these strip-only: declare the field and assign it in the constructor (no parameter property, enum or namespace).');
    process.exit(1);
  }
  console.log('strip-only: every TypeScript file Node runs here is erasable');
}
