// G320: classify a producer's real import closure before a clean-room job can execute.
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from '@typescript/typescript6';

const folders = new Set(['generators', 'data', 'quests', 'blender', 'assets', 'behaviour']);
const layers = new Set(['sdk', 'sharddev', 'commons']);

/** Resolve only static string syntax. No identifiers, calls or interpolated values qualify.
 * @param {import('@typescript/typescript6').Node | undefined} node @returns {string | null} */
function literalName(node) {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalName(node.left), right = literalName(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

/** Authoring sources belong to this shard or the two authoring packages; runtime and legacy never qualify.
 * @param {string} file @param {string} shard */
export function isAuthoringInput(file, shard) {
  const parts = file.split('/');
  if (parts.includes('runtime') || parts.some(part => part.endsWith('-legacy'))) return false;
  return parts[0] === 'src' && (layers.has(parts[1] ?? '') ||
    parts[1] === 'shards' && parts[2] === shard && folders.has(parts[3] ?? ''));
}

/** Resolve literal imports without running a loader, installing game services or accepting escaping symlinks.
 * @param {string} root @param {string} shard @param {string} entry
 * @returns {import('./authoring-inputs.mjs').AuthoringAudit} */
export function auditAuthoringInputs(root, shard, entry) {
  const base = realpathSync(root);
  /** @type {import('./authoring-inputs.mjs').AuthoringIssue[]} */
  const issues = [];
  const seen = new Set();
  /** @type {{file:string,from:string|null}[]} */
  const queue = [{file: entry, from: null}];
  /** @param {string} path */
  function sourceAt(path) {
    for (const suffix of ['', '.ts', '.mts', '.cts', '.tsx', '.mjs', '.js', '.cjs', '.jsx', '.json', '.d.ts', '/index.ts']) {
      const file = path + suffix;
      if (existsSync(file) && lstatSync(file).isFile()) return file;
    }
    return null;
  }
  /** @param {string} file @param {string} name */
  function resolveImport(file, name) {
    if (name.startsWith('.')) {
      const target = resolve(base, dirname(file), name);
      return isAuthoringInput(relative(base, target).split(sep).join('/'), shard) ? sourceAt(target) : target;
    }
    const match = /^@wildshard\/(sdk|sharddev|commons|game|engine)(\/.*)$/u.exec(name);
    if (name.startsWith('@wildshard/format/')) return undefined; // Installed, like any other dependency.
    if (match === null) return name.startsWith('@wildshard/') || name.startsWith('#') ? null : undefined;
    const layer = match.at(1), module = match.at(2);
    if (layer === undefined || module === undefined) return null;
    const packageFile = resolve(base, 'src', layer, 'package.json');
    if (!existsSync(packageFile)) return null;
    const manifest = JSON.parse(readFileSync(packageFile, 'utf8'));
    const target = manifest.exports?.[`.${module}`];
    if (typeof target !== 'string') return null;
    return sourceAt(resolve(dirname(packageFile), target));
  }
  for (let index = 0; index < queue.length; index++) {
    const row = queue.at(index);
    if (row === undefined || seen.has(row.file)) continue;
    seen.add(row.file);
    const rowFile = row.file;
    const absolute = resolve(base, rowFile);
    if (isAbsolute(row.file) || row.file.split('/').includes('..')) {issues.push({...row, reason: 'outside-authoring'}); continue;}
    if (!isAuthoringInput(row.file, shard)) {
      issues.push({...row, reason: 'outside-authoring'});
      if (row.file !== entry) continue;
    }
    if (!existsSync(absolute)) { issues.push({...row, reason: 'missing'}); continue; }
    if (lstatSync(absolute).isSymbolicLink() || realpathSync(absolute) !== absolute) {
      issues.push({...row, reason: 'symlink'}); continue;
    }
    if (!/\.(?:ts|mts|cts|tsx|mjs|js|cjs|jsx)$/u.test(row.file)) continue;
    const tree = ts.createSourceFile(row.file, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true);
    /** @type {string[]} */
    const imports = [];
    /** @param {import('@typescript/typescript6').Node} node */
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        const name = literalName(node.arguments.at(0));
        if (name !== null) imports.push(name);
        else issues.push({file: rowFile, from: rowFile, reason: 'computed-import'});
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob') issues.push({file: rowFile, from: rowFile, reason: 'glob-import'});
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const name of imports) {
      const target = resolveImport(row.file, name);
      if (target === null) issues.push({file: name, from: row.file, reason: 'unresolved-import'});
      else if (target !== undefined) queue.push({file: relative(base, target).split(sep).join('/'), from: row.file});
    }
  }
  return {entry, files: [...seen].sort((a,b) => a < b ? -1 : a > b ? 1 : 0), issues};
}
