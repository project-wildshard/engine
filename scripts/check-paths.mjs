#!/usr/bin/env node
// E357 F1: reject stale tooling paths and import.meta.glob patterns before a move can make a check vacuous.
// Run from the repository root; tests run this same CLI from a small temporary tree.
import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { checkShards } from './check-shards.mjs';
import { formatLockFailures } from './format-lock.mjs';
import { onDisk } from './format-package.mjs';
import { checkGeneratedSourceTree } from './generated-source.mjs';

const ROOT = process.cwd();
const failures = new Set();
for (const failure of checkGeneratedSourceTree(ROOT)) failures.add(failure);
/** @param {string} path */
const readTree = path => (existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path), 'utf8') : undefined);
for (const failure of formatLockFailures(readTree, globSync('.github/workflows/*.yml', { cwd: ROOT }))) failures.add(failure);
const allowFile = 'scripts/check-paths.allow.json';
const allow = existsSync(resolve(ROOT, allowFile)) ? JSON.parse(readFileSync(resolve(ROOT, allowFile), 'utf8')) : [];
const allowed = new Set();
if (!Array.isArray(allow)) failures.add(`${allowFile}: expected an array`);
else for (const entry of allow) {
  if (typeof entry?.path !== 'string' || typeof entry.file !== 'string' || typeof entry.why !== 'string' || !entry.why.trim()) {
    failures.add(`${allowFile}: every entry needs path, file and a non-empty why`);
    continue;
  }
  const at = resolve(ROOT, entry.file);
  if (!existsSync(at) || !readFileSync(at, 'utf8').includes(entry.path)) failures.add(`${allowFile}: stale allowance ${entry.file}: ${entry.path}`);
  allowed.add(`${entry.file}\0${entry.path}`);
}

const PATH = /^(?:\.\/)?(?:src|test)\//;
const GLOB = /[*{?[]/;
const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
const ARGUMENT = `(?:\\[(?:\\s|,|${STRINGS.source})*\\]|${STRINGS.source})`;
const CALLS = new RegExp(`${STRINGS.source}|\\bimport\\.meta\\.glob(?:<[^()]*>)?\\s*\\(\\s*(${ARGUMENT})`, 'g');
// Preserve strings and line positions while blanking comments. Documentation of deleted paths is not executable code.
/** @param {string} text @param {boolean} shell */
function codeOnly(text, shell) {
  const tokens = shell
    ? /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|#[^\n]*/g
    : /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
  return text.replaceAll(tokens, (/** @type {string} */ token) => (token.startsWith(shell ? '#' : '/') ? token.replaceAll(/[^\n]/g, ' ') : token));
}
/** @param {string} text */
function strings(text) {
  return [...text.matchAll(STRINGS)].filter((m) => !(m[0].startsWith('`') && m[0].includes('${')));
}
/** @param {string} file @param {string} text @param {string} path @param {number} index @param {string} [folder] */
function check(file, text, path, index, folder = ROOT) {
  if (allowed.has(`${file}\0${path}`)) return;
  // Component ownership keys append a declaration name to an existing module.
  const target = file === 'scripts/shard-components.mjs' ? path.split('#')[0] : path;
  // Censuses and G571 approvals keep format's logical src/format/x.ts labels (format-package.mjs): check where they live.
  const at = onDisk(folder, target.replace(/^\.\//u, ''));
  const found = GLOB.test(path) ? globSync(at).some((p) => statSync(p).isFile()) : existsSync(at);
  if (!found) failures.add(`${file}:${text.slice(0, index).split('\n').length}: ${GLOB.test(path) ? 'empty glob' : 'missing path'} ${path}`);
}

const tooling = globSync(['scripts/**/*.{mjs,js,sh,py,json}', 'src/shards/*/generators/**/*.mjs', 'src/shards/*/blender/**/*.{mjs,py}', 'vite.config.ts', 'vite/**/*.ts', '.oxlintrc.json'], { cwd: ROOT });
for (const file of tooling) {
  if (file === allowFile || file === 'scripts/normalize/move.dry-run.json') continue; // allowances are checked against their named file, not as paths in this JSON
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const shell = /\.(sh|py)$/.test(file);
  // Python docstrings are documentation, just like JS block comments.
  const source = file.endsWith('.py') ? text.replaceAll(/^[ \t]*(?:"""[\s\S]*?"""|'''[\s\S]*?''')/gm, token => token.replaceAll(/[^\n]/g, ' ')) : text;
  const code = codeOnly(source, shell);
  for (const match of strings(code)) {
    const prefix = code.slice(Math.max(0, match.index - 2), match.index);
    if (file.endsWith('.py') && /\b(?:f|fr|rf)$/iu.test(prefix)) continue;
    const path = match[0].slice(1, -1);
    if (file.endsWith('.py') && /\br$/.test(prefix) && /[\\^$]/.test(path)) continue;
    if (PATH.test(path)) check(file, text, path, match.index);
  }
  // Match standalone tokens, never a suffix of /tmp/.../src or weapons-src/...; punctuation may follow prose paths.
  const unquoted = code.replaceAll(STRINGS, (/** @type {string} */ token) => token.replaceAll(/[^\n]/gu, ' '));
  if (shell) for (const match of unquoted.matchAll(/(?<![\w/.-])(?:\.\/)?src\/[\w./*{}?[\],$-]+/g)) check(file, text, match[0].replace(/[.,]$/, ''), match.index);
}

for (const file of globSync(['src/**/*.ts', 'test/**/*.ts'], { cwd: ROOT })) {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const code = codeOnly(text, false);
  // Vite's optional generic precedes the call; only the first argument supplies glob patterns.
  for (const call of code.matchAll(CALLS)) for (const match of strings(call[1] ?? '')) {
    const pattern = match[0].slice(1, -1);
    if (pattern.startsWith('!')) continue;
    const folder = pattern.startsWith('/') ? ROOT : dirname(resolve(ROOT, file));
    check(file, text, pattern.startsWith('/') ? pattern.slice(1) : pattern, call.index, folder);
  }
}

// E362 AG9: the same policy also runs in pnpm test, beyond pre-commit and the Vitest CI check.
if (existsSync(resolve(ROOT, 'lint/shard-layout.json'))) for (const failure of checkShards(ROOT)) failures.add(failure);

if (failures.size > 0) {
  console.error(`check-paths: ${failures.size} failure(s)\n${[...failures].sort((a, b) => a.localeCompare(b)).join('\n')}`);
  process.exitCode = 1;
} else console.info('check-paths: all tooling paths and code globs exist');
