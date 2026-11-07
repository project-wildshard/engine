// Source-only push helpers: no imports execute and no products are built.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { exportedPath } from '../lint/layer-exports.mjs';
import { pushGuards } from './gate-related-tests.mjs';

/** @param {string} root @param {boolean} codeOnly @returns {string[]} */
function sources(root, codeOnly = true) {
  /** @type {string[]} */
  const files = [];
  for (const folder of ['src', 'scripts', 'test', 'lint', 'admin', 'api', 'drafts', 'vite']) {
    const base = resolve(root, folder);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base, { recursive: true })) {
      if ((codeOnly ? /\.[cm]?[jt]sx?$/u : /\.(?:[cm]?[jt]sx?|py|sh|json)$/u).test(name)
        && !name.split('/').includes('node_modules')) files.push(`${folder}/${name}`);
    }
  }
  return files;
}

/** Typed importer checks use only the exact generated set, after tests.
 * @param {string} root @param {readonly string[]} changed @returns {string[]} */
export function importerFiles(root, changed) {
  const config = ts.findConfigFile(root, path => ts.sys.fileExists(path));
  const options = config === undefined ? {} : ts.parseJsonConfigFileContent(
    ts.readConfigFile(config, path => ts.sys.readFile(path)).config, ts.sys, root).options;
  /** @type {Map<string, Set<string>>} */
  const reverse = new Map();
  for (const file of sources(root)) {
    const path = resolve(root, file);
    for (const imported of ts.preProcessFile(readFileSync(path, 'utf8'), true, true).importedFiles) {
      const target = ts.resolveModuleName(imported.fileName, path, options, ts.sys).resolvedModule;
      if (target === undefined) continue;
      const name = relative(root, target.resolvedFileName);
      const parents = reverse.get(name) ?? new Set();
      parents.add(file); reverse.set(name, parents);
    }
  }
  const seen = new Set(changed), queue = [...changed];
  for (let index = 0; index < queue.length; index++) {
    for (const file of reverse.get(queue[index] ?? '') ?? []) if (!seen.has(file)) { seen.add(file); queue.push(file); }
  }
  return queue.filter(file => /\.[cm]?[jt]sx?$/u.test(file) && existsSync(resolve(root, file)) && !file.includes('.generated.'));
}

/** Literal imports and repository paths must not point at an outgoing deletion.
 * @param {string} root @param {readonly string[]} deleted @returns {string[]} */
export function deletedReferences(root, deleted) {
  // Format moved to the shardfile repo: its package imports are good, and its old paths live on as logical labels.
  const removed = new Set(deleted.filter(path => !path.startsWith('src/format/'))), errors = [];
  if (removed.size === 0) return errors;
  const allowFile = resolve(root, 'scripts/check-paths.allow.json');
  /** @type {{file: string, path: string}[]} */
  const allow = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, 'utf8')) : [];
  const inventory = resolve(root, '.push-tracked.json');
  /** @type {string[] | undefined} */
  const committed = existsSync(inventory) ? JSON.parse(readFileSync(inventory, 'utf8')) : undefined;
  for (const file of sources(root, false)) {
    // G606: frozen legacy references are historical, never active consumers.
    if (/^src\/shards\/[^/]+-legacy\//u.test(file) || file.startsWith('test/fixtures/') || file === 'scripts/check-paths.allow.json' || file === 'scripts/normalize/move.dry-run.json') continue; // the dry run is a record, as in check-paths
    if (committed !== undefined && !committed.includes(file)) continue;
    const path = resolve(root, file), text = readFileSync(path, 'utf8');
    const syntax = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    /** @param {string} literal @param {number} line */
    const check = (literal, line) => {
      if (allow.some(row => row.file === file && row.path === literal)) return;
      const layer = /^@wildshard\/(engine|game)\/(.+)$/u.exec(literal), exported = layer === null ? null : exportedPath(layer[1], layer[2], root);
      if (exported !== null && existsSync(resolve(root, exported))) return; // J122: the export, not the folder, names it
      if (/^src\/[^/]+\/package\.json$/u.test(file) && literal.startsWith('./')) return; // the file's `exports` table: resolve checks it
      const name = literal.startsWith('.') ? relative(root, resolve(dirname(path), literal))
        : literal.replace(/^@wildshard\//u, 'src/');
      const matches = [name, `${name}.ts`, `${name}.mts`, `${name}.mjs`, `${name}/index.ts`,
        name.replace(/\.js$/u, '.ts').replace(/\.mjs$/u, '.mts').replace(/\.jsx$/u, '.tsx')];
      const target = matches.find(candidate => removed.has(candidate));
      if (target !== undefined && !existsSync(resolve(root, target))) errors.push(`${file}:${line}: deleted path ${target}`);
    };
    /** @param {ts.Node} node */
    const visit = node => {
      if (ts.isStringLiteralLike(node)) {
        check(node.text, syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1);
      }
      ts.forEachChild(node, visit);
    };
    if (/\.(?:py|sh)$/u.test(file)) {
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? '';
        if (line.trimStart().startsWith('#')) continue;
        for (const match of line.matchAll(/['"]([^'"\n]+)['"]/gu)) check(match[1], index + 1);
      }
    } else visit(syntax);
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const mode = process.argv[2], listing = process.argv[3];
  if (process.argv.length < 4) throw new Error('push-checks requires a path listing');
  /** @type {string[]} */
  const changed = JSON.parse(readFileSync(listing, 'utf8'));
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
  /** @param {string[]} files */
  const emit = files => {
    const payload = `${JSON.stringify(files)}\n`;
    if (output !== undefined) writeFileSync(resolve(output), payload);
    else process.stdout.write(payload);
  };
  if (mode === 'guards') emit(pushGuards(changed));
  else if (mode === 'importers') emit(importerFiles(process.cwd(), changed));
  else if (mode === 'deleted') {
    const errors = deletedReferences(process.cwd(), changed);
    if (errors.length > 0) { console.error(errors.join('\n')); process.exitCode = 1; }
  } else throw new Error('Unknown push-checks mode');
}
