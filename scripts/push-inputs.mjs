// Source-only dependency walk: no imports execute and no products are prepared.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from '@typescript/typescript6';

/** @param {string} root */
export function sourceWalker(root, runtimeOnly = false, includeMissing = false) {
  const config = ts.findConfigFile(root, path => ts.sys.fileExists(path));
  const options = config === undefined ? { allowJs: true } : ts.parseJsonConfigFileContent(
    ts.readConfigFile(config, path => ts.sys.readFile(path)).config, ts.sys, root).options;
  /** @type {Map<string,string[]>} */
  const imports = new Map();
  /** @param {readonly string[]} files @returns {string[]} */
  return files => {
  const pending = files.map(file => resolve(root, file));
  const seen = new Set();
  while (pending.length > 0) {
    const path = pending.pop();
    if (path === undefined || seen.has(path)) continue;
    const name = relative(root, path);
    if (name.startsWith('..') || name.split('/').includes('node_modules')) continue;
    if (!existsSync(path)) { if (includeMissing) seen.add(path); continue; }
    seen.add(path);
    if (!/\.[cm]?[jt]sx?$/u.test(path)) continue;
    const cached = imports.get(path);
    if (cached !== undefined) { pending.push(...cached); continue; }
    const dependencies = [];
    const source = readFileSync(path, 'utf8');
    const syntax = runtimeOnly ? ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true) : undefined;
    const runtime = new Set(syntax?.statements.flatMap(statement => {
      if (ts.isImportDeclaration(statement) && statement.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword && ts.isStringLiteral(statement.moduleSpecifier)) return [statement.moduleSpecifier.text];
      if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) return [statement.moduleSpecifier.text];
      return [];
    }));
    const erased = new Set(syntax?.statements.flatMap(statement => {
      if (ts.isImportDeclaration(statement) && statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword && ts.isStringLiteral(statement.moduleSpecifier)) return [statement.moduleSpecifier.text];
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) return [statement.moduleSpecifier.text];
      return [];
    }));
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      if (erased.has(imported.fileName) && !runtime.has(imported.fileName)) continue;
      const module = ts.resolveModuleName(imported.fileName, path, options, ts.sys).resolvedModule;
      if (module !== undefined) {
        const declared = module.resolvedFileName;
        const target = runtimeOnly ? declared.replace(/\.d\.json\.ts$/u, '.json').replace(/\.d\.mts$/u, '.mjs') : declared;
        if (runtimeOnly && (/\.d\.[cm]?ts$/u.test(target) || !includeMissing && !existsSync(target))) continue;
        dependencies.push(target);
        // A handwritten .d.mts types the script; its implementation still runs.
        const implementation = target.replace(/\.d\.mts$/u, '.mjs');
        if (implementation !== target && existsSync(implementation)) dependencies.push(implementation);
      } else if (includeMissing && imported.fileName.startsWith('.')) {
        dependencies.push(resolve(dirname(path), imported.fileName));
      }
    }
    // Disk/script readers have literal paths without an import edge.
    for (const match of (runtimeOnly ? [] : source.matchAll(/['"`]((?:scripts|test|src)\/[\w./-]+\.(?:[cm]?[jt]s|py|sh|json))['"`]/gu))) {
      const file = match[1];
      dependencies.push(resolve(root, file));
    }
    imports.set(path, dependencies);
    pending.push(...dependencies);
  }
  return [...seen].map(path => relative(root, path)).sort((a,b) => a.localeCompare(b));
  };
}

/** @param {string} root @param {readonly string[]} files @returns {string[]} */
export function sourceInputs(root, files) { return sourceWalker(root)(files); }

// These fixtures deliberately own app builders or long-lived lane processes.
// Importing a module which mentions spawn is not a reason to skip a test.
const EXTERNAL_JOBS = new Set([
  'test/build-mirror.test.ts', 'test/heavy-lane.test.ts',
  'test/push-loop.test.ts', 'test/catalog-build.test.ts',
  'test/product-report-failure.test.ts',
]);

/** Missing declared generation outputs are product inputs, not missing author source.
 * @param {string} _root @param {readonly string[]} tests @param {Record<string,string[]>} products
 * @param {readonly string[]} _changed outgoing paths, including deletions
 * @returns {{run: string[], deferred: {test: string, reason: string}[]}} */
export function liveTestSelection(_root, tests, products, _changed = []) {
  const run = [], deferred = [];
  for (const test of tests) {
    let reason;
    if (EXTERNAL_JOBS.has(test)) reason = 'external builder/process fixture';
    else if (products[test]?.length) reason = `products: ${products[test].join(',')}`;
    if (reason === undefined) run.push(test);
    else deferred.push({ test, reason });
  }
  return { run, deferred };
}

/** @param {string} root @param {readonly string[]} tests @param {Record<string,string[]>} products */
export function liveTests(root, tests, products) { return liveTestSelection(root, tests, products).run; }

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  console.info(JSON.stringify(sourceInputs(process.cwd(), process.argv.slice(2))));
}
