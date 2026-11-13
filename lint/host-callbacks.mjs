// G454: typed build-time host catalogue; oxlint uses host-callback-syntax.
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { hostPlayFile } from './host-files.mjs';
import { shardFile, shardSourceDirs } from './shard-source.mjs';
import { formatSource } from '../scripts/format-package.mjs';

const projects = new Map();
const localPath = (root, file) => relative(root, file).replaceAll('\\', '/');
const platform = file => /^src\/(?:engine|game|sdk|sharddev)\//u.test(file);
/** One compiler/checker per immutable tree; no diagnostics or emit, only binding/signature resolution. */
export function hostAnalysis(inputRoot) {
  const root = resolve(inputRoot);
  if (projects.has(root)) return projects.get(root);
  const configFile = resolve(root, 'tsconfig.json');
  const config = existsSync(configFile) ? ts.readConfigFile(configFile, file => ts.sys.readFile(file)).config : {};
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const files = shardSourceDirs(root).flatMap(dir => ts.sys.readDirectory(resolve(root, dir), ['.ts', '.tsx', '.mts', '.cts'], ['**/node_modules/**', '**/dist/**']))
    .filter(file => hostPlayFile(root, localPath(root, file)));
  const sectionRegistry = formatSource(root, 'sections.ts');
  const program = ts.createProgram([...files, ...existsSync(sectionRegistry) ? [sectionRegistry] : []], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const scans = new Map();
  const pathOf = node => localPath(root, node.getSourceFile().fileName);
  const unalias = symbol => symbol?.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const nameOf = node => node?.name?.getText() ?? 'default';
  const hostOf = declaration => {
    if (!declaration || !platform(pathOf(declaration))) return null;
    let owner = declaration, member;
    while (owner.parent && !ts.isSourceFile(owner.parent)) {
      if (owner.name) member = nameOf(owner);
      if (ts.isVariableDeclaration(owner)) break;
      owner = owner.parent;
    }
    if (member === nameOf(owner)) member = undefined;
    return { module: pathOf(declaration), export: nameOf(owner), ...(member === undefined || member === 'default' ? {} : { member }) };
  };
  const unwrap = node => ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node) ? unwrap(node.expression) : node;

  // Explicit function values, including named aliases and shard-authored option bags.
  // Opaque engine service instances are not expanded into all their inherited methods.
  function typeLeaves(type, node, label, seen = new Set()) {
    if (seen.has(type)) return [];
    const next = new Set(seen).add(type);
    if (type.isUnion()) return [...new Set(type.types.flatMap(part => typeLeaves(part, node, label, next)))];
    if (type.getCallSignatures().length > 0) return [label];
    return checker.getPropertiesOfType(type).flatMap(property => {
      const decl = property.valueDeclaration;
      if (!decl || shardFile(root, pathOf(decl)) === null) return [];
      return typeLeaves(checker.getTypeOfSymbolAtLocation(property, node), node, `${label}.${property.name}`, next);
    });
  }
  function leaves(input, label, seen = new Set()) {
    const node = unwrap(input);
    if (seen.has(node)) return [];
    const next = new Set(seen).add(node);
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) return [label];
    if (ts.isConditionalExpression(node)) return [...leaves(node.whenTrue, `${label}.true`, next), ...leaves(node.whenFalse, `${label}.false`, next)];
    if (ts.isObjectLiteralExpression(node)) return node.properties.flatMap(property => {
      if (ts.isSpreadAssignment(property)) return leaves(property.expression, `${label}.*`, next);
      if (ts.isMethodDeclaration(property)) return [`${label}.${nameOf(property)}`];
      if (ts.isPropertyAssignment(property)) return leaves(property.initializer, `${label}.${nameOf(property)}`, next);
      if (ts.isShorthandPropertyAssignment(property)) return leaves(property.name, `${label}.${nameOf(property)}`, next);
      return [];
    });
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((entry, index) => leaves(ts.isSpreadElement(entry) ? entry.expression : entry, `${label}[${index}]`, next));
    const type = checker.getTypeAtLocation(node);
    if (type.getCallSignatures().length > 0) return [label];
    const symbol = unalias(checker.getSymbolAtLocation(node));
    const declaration = symbol?.valueDeclaration;
    if (declaration && (ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)) && declaration.initializer) {
      return leaves(declaration.initializer, label, next);
    }
    // Function-valued fields on shard-defined parameter/return types are forwarded too.
    return typeLeaves(type, node, label);
  }

  function scan(file) {
    if (scans.has(file)) return scans.get(file);
    const source = program.getSourceFile(resolve(root, file));
    if (!source || !hostPlayFile(root, file)) return { calls: [], callbacks: [] };
    const calls = [], callbacks = [];
    function walk(node) {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        let signature = checker.getResolvedSignature(node);
        // Function.call/apply/bind resolve to lib.es5, not the actual platform function.
        const expression = node.expression;
        const indirect = ts.isPropertyAccessExpression(expression) && ['call', 'apply', 'bind'].includes(expression.name.text);
        if (indirect && !hostOf(signature?.declaration)) signature = checker.getTypeAtLocation(expression.expression).getCallSignatures()[0];
        const host = hostOf(signature?.declaration);
        if (host) {
          const start = node.getStart(source), end = node.getEnd();
          const strings = [...node.arguments ?? []].flatMap(argument => {
            const type = checker.getTypeAtLocation(argument);
            return type.isStringLiteral() ? [type.value] : [];
          });
          calls.push({ ...host, file, start, end, strings });
          for (const [index, argument] of [...node.arguments ?? []].entries()) {
            if (indirect && index === 0) continue;
            for (const path of new Set(leaves(argument, `arg${index}`))) callbacks.push({
              ...host, file, start: argument.getStart(source), end: argument.getEnd(), path,
              message: `Shard TS callback ${path} crosses ${host.module}#${host.export}${host.member ? `.${host.member}` : ''}; pass data or a Wasm reference (G454)`,
            });
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    const result = { calls, callbacks };
    scans.set(file, result);
    return result;
  }
  const result = { program, checker, files: files.map(file => localPath(root, file)).filter(file => hostPlayFile(root, file)), scan };
  projects.set(root, result);
  return result;
}

/** Raw sites, with no migration allowance. Used only on immutable compiler inputs. */
export function hostCallbackViolations(root, file) { return hostAnalysis(root).scan(file).callbacks; }
