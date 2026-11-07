#!/usr/bin/env node
// G291: authored runtime TS / the frozen legacy TS size; G604: a shard passes only at zero.
// G417: one measure only; platform-native shards have no frozen denominator.
import { representativeProduct, shardProducts } from './shard-outputs.mjs';
import { productManifestPath } from './authored-manifest.mjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSync } from 'vite';
import * as v from 'valibot';
import { resolveSpecifier } from './check-graph.mjs';
import { g571HostApprovals, approvedG571Host } from './g571-hosts.mjs';
import { declarationConfigProgram } from '../lint/declaration-config.mjs';
import { shardLineBaselines } from './decision-legacy-lines.mjs';
import { componentInventory, COMPONENT_SHARDS, SHARD_WAVES } from './shard-components.mjs';
import { loadListedViews, listedViewInventory } from './listed-view-code.mjs';
import { createOutputReader } from './shard-platform-output.mjs';
import { sectionHostImports } from './shard-platform-hosts.mjs';
import { runtimeClosures } from './shard-runtime-closure.mjs';
import { chargePlatformUsers, hasChargebackDeclarations, inlinePlatformPaths, inlinePlatformSpans, platformChargeback, recordPrivateCharge, retiredPlatformModule } from './platform-chargebacks.mjs';
import { onDisk } from './format-package.mjs';

// The compiler's declarations globally replace Array.at's optional return with T. Load its JS API
// behind a checked local contract, as compile-script.mjs does, so host JS keeps native Node types.
/** @typedef {{comments?: unknown, diagnostics: unknown[], sources: {statements: {kind:number,path?:{value:string}|null}[]}[], onComment: ((kind:number,text:string,range:{start:number,end:number})=>void)|null, parseFile:(source:string,path:string,entry:boolean)=>void}} AssemblyParser */
/** @typedef {{Parser:new()=>AssemblyParser,NodeKind:{Import:number,Export:number}}} AssemblyApi */
/** @param {unknown} value @returns {value is AssemblyApi} */
function isAssemblyApi(value) {
  return typeof value === 'object' && value !== null && 'Parser' in value && typeof value.Parser === 'function'
    && 'NodeKind' in value && typeof value.NodeKind === 'object' && value.NodeKind !== null
    && 'Import' in value.NodeKind && typeof value.NodeKind.Import === 'number'
    && 'Export' in value.NodeKind && typeof value.NodeKind.Export === 'number';
}
const compilerSpecifier = ['assembly', 'script'].join('');
/** @type {unknown} */
const compiler = await import(compilerSpecifier);
if (!isAssemblyApi(compiler)) throw new Error('AssemblyScript parser API unavailable');
const { Parser, NodeKind } = compiler;

const ROOT = resolve(import.meta.dirname, '..');
const LIST = 'lint/shard-platform.json';
const sourceFile = /\.(?:tsx?|as|glsl|json)$/u;
const producerPath = v.pipe(v.string(), v.check(path => path.length > 0 && !path.startsWith('/') && !path.includes('\\')
  && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')));
const SourceOutputs = v.strictObject({ schema: v.literal('source-generation-outputs/1'),
  producers: v.record(producerPath, v.array(producerPath)) });
// G291/G294's classification table. Audit findings adjust these rules explicitly, never hidden import heuristics.
// Unit on BOTH sides: nonblank physical lines after parser comment removal, in .ts/.tsx only;
// .as, .d.ts and tests do not enter the TS ratio. A built product ships no runtime TS (LD10 retired the
// copied-runtime measurement), so the output basis counts its section hosts and private bytes only.
// Authoring directories have no numerator exemption rules: they are not inputs.
// The registered frozen denominator pins historical per-file counts and producer exclusions.
// G294 adds one-user platform modules to the numerator; relocating a helper into engine/game/SDK cannot reduce it.
// G456 H2: SDK bake modules and project validation are build tools, never shard runtime debt.
// This exact path exception does not exempt SDK runtime modules or their dependencies.
// G294 per export (sp-o53): users are counted per top-level declaration, not only per file, so a one-shard export moved
// into an already shared file still counts. A file one shard reaches counts whole (unchanged, dead code included). In a
// file two or more shards reach, each top-level declaration (export or helper; type declarations too) that exactly one
// shard reaches counts its own span: nonblank lines after parser comment removal (the codeLines unit), each line once.
// Its users are the shards whose own files import it, directly or through declarations of other engine/game/SDK/commons
// modules they reach. Where the reading is ambiguous the rule picks the one that never hides a real use:
//   - names match top-level bindings lexically (no scope analysis): a local that shadows one still counts as a use;
//   - literal members and destructuring of an awaited import reach those exports; escaping namespaces, import
//     promises, `require()` and unqualified `import('x')` types conservatively reach every export;
//   - a shard's runtime roots and their local dependencies are used in full; build-only folders supply no users;
//   - evaluating a module runs its non-declaration top-level statements, so what they reference is used by every shard
//     that reaches the file; a variable initialiser belongs to its binding. Import lines and top-level statements of a
//     shared file stay shared, and a declaration no shard reaches counts for no shard.
// The frozen denominator attributes no platform code (only the sealed legacy files), so no per-export rule applies there.
const RULES = {
  typescript: /\.tsx?$/u,
  tests: /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.tsx?$/u,
  attributedLayers: /^src\/(?:engine|game|sdk|sharddev)\//u,
  buildOnlySdk: /^src\/sharddev\/(?:bake\/|project\.ts$)/u,
  publicUserCount: 2,
  template: '_template',
  enforcement: 'report-only',
};
// AssemblyScript permits function decorators that TypeScript parsers stop at. Use its own parser.
function assembly(source, path) {
  const parser = new Parser(), comments = new Map();
  parser.onComment = (_kind, _text, range) => { comments.set(range.start, { start: range.start, end: range.end }); };
  parser.parseFile(source, path.replace(/\.as$/u, '.ts'), true);
  if (parser.diagnostics.length > 0 || parser.sources.length !== 1) throw new Error(`Cannot measure invalid AssemblyScript: ${path}`);
  return { comments: [...comments.values()].sort((a, b) => a.start - b.start), statements: parser.sources[0].statements };
}

/** Parser comment spans preserve strings, regexes and template literals containing comment-looking text. */
export function codeLines(source, path = 'measure.ts') {
  const comments = path.endsWith('.as') ? assembly(source, path).comments : parseSync(path, source).comments;
  return linesWithoutComments(source, comments);
}
function linesWithoutComments(source, comments) {
  const chunks = [];
  let cursor = 0;
  for (const { start, end } of comments) {
    chunks.push(source.slice(cursor, start), source.slice(start, end).replaceAll(/[^\n]/gu, ' '));
    cursor = end;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('').split('\n').filter((line) => line.trim()).length;
}
/** Count raw GLSL statements without blank/comment padding, preserving quoted preprocessor paths. */
export function shaderCodeLines(source) {
  return source.replaceAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/gu, value =>
    value.startsWith('/') ? value.replaceAll(/[^\n]/gu, ' ') : value).split('\n').filter(line => line.trim()).length;
}
/** Raw shader source remains custom even inside a data/generator TS file; SF59 graph nodes are ordinary data. */
/** @param {string} source @param {string} path @param {unknown} [program] the file's own parse of `source`, reused when given */
export function rawShaderLines(source, path, program) {
  if (path.endsWith('.glsl')) return shaderCodeLines(source);
  // G480: JSON is a container, never an exemption for executable source.
  // Decode strings first, so escaped newlines use the same unit as .ts/.glsl.
  if (path.endsWith('.json')) {
    const visit = (value, name = '') => {
      if (Array.isArray(value)) return value.reduce((sum, child) => sum + visit(child, name), 0);
      if (value !== null && typeof value === 'object') return Object.entries(value)
        .reduce((sum, [key, child]) => sum + visit(child, key), 0);
      if (typeof value !== 'string') return 0;
      if (shaderText(value, name)) return shaderCodeLines(value);
      const expressionField = /^(?:code|script|expression|javascript|typescript|callback)$/iu.test(name);
      if (!/[;{}=]/u.test(value) && !expressionField && !(name === 'source' && /[()]/u.test(value))) return 0;
      const wrapped = `function embedded() {\n${value}\n}`;
      const parsed = parseSync('embedded.ts', wrapped);
      if (parsed.errors.length > 0) return 0;
      const executable = node => {
        if (node === null || typeof node !== 'object') return false;
        if (/^(?:Variable|Function|Class)Declaration$|^(?:Return|Throw|If|For|ForIn|ForOf|While|DoWhile|Switch|Try)Statement$|^(?:ArrowFunction|Function|Assignment|Update|Call|New)Expression$/u.test(node.type)) return true;
        if (expressionField
          && /^(?:Binary|Logical|Conditional|Await|Unary)Expression$/u.test(node.type)) return true;
        return Object.values(node).some(child => Array.isArray(child) ? child.some(executable) : executable(child));
      };
      return executable(parsed.program.body[0].body) ? linesWithoutComments(wrapped, parsed.comments) - 2 : 0;
    };
    return visit(JSON.parse(source));
  }
  if (!RULES.typescript.test(path)) return 0;
  let total = 0;
  const visit = (node, inheritedName = '') => {
    let name = inheritedName;
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'Property') name = node.key?.name ?? node.key?.value ?? name;
    if (node.type === 'VariableDeclarator') name = node.id?.name ?? name;
    const value = node.type === 'TemplateLiteral' ? node.quasis.map(part => part.value.raw).join('\n')
      : node.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
    if (value !== null && (shaderText(value, name)
      || /\/\*\s*glsl\s*\*\/\s*$/u.test(source.slice(Math.max(0, node.start - 24), node.start)))) {
      total += shaderCodeLines(value);
      return;
    }
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(part => { visit(part, name); }); else visit(child, name);
  };
  visit(program ?? parseSync(path, source).program);
  return total;
}
function shaderText(value, name) {
  return /\b(?:uniform|varying|attribute|precision)\s+|\b(?:vec[234]|mat[234]|sampler2D)\s+\w+|\bvoid\s+main\s*\(|#include\s*</u.test(value)
    || /\b(?:float|int|uint|bool)\s+\w+\s*[=;(]/u.test(value)
    || (/glsl|shader|^vertex|^fragment/iu.test(name) && /[;{}]/u.test(value));
}
// G571/G573: JSON module contracts erase completely. The unusual suffix is
// not enough: executable statements under that name remain custom code.
export function jsonTypeContract(source, path) {
  if (!path.endsWith('.d.json.ts')) return false;
  const program = parseSync(path, source).program;
  const declared = new Set(program.body.flatMap(row => row.type === 'VariableDeclaration' && row.declare
    ? row.declarations.filter(entry => entry.id.type === 'Identifier' && entry.init === null).map(entry => entry.id.name) : []));
  return program.body.every(row => {
    if (row.type === 'ImportDeclaration') return row.importKind === 'type' || row.specifiers.length > 0 && row.specifiers.every(spec => spec.importKind === 'type');
    if (row.type === 'TSTypeAliasDeclaration' || row.type === 'TSInterfaceDeclaration' || row.type === 'EmptyStatement') return true;
    if (row.type === 'VariableDeclaration') return row.declare && row.declarations.every(entry => entry.id.type === 'Identifier' && entry.init === null);
    if (row.type === 'ExportDefaultDeclaration') return row.declaration.type === 'Identifier' && declared.has(row.declaration.name);
    return row.type === 'TSExportAssignment' && row.expression.type === 'Identifier' && declared.has(row.expression.name);
  });
}
/** G392 call 36: a thin declaration entry is not custom; executable logic is. */
export function declarationOnlyConfig(source, path = 'shard.config.ts') {
  return declarationConfigProgram(parseSync(path, source).program);
}

/** G423 extends call 36 to root manifest.ts only. Literal rows, const aliases, imported
 * values/member reads, spreads and erased TS types are declarations; referenced modules keep
 * their existing reach/counts. No calls (even config wrappers), mutation, functions, classes,
 * control flow or bare side-effect imports qualify. Unknown syntax stays custom. Raw GLSL
 * literals still count separately, just as they do in data/. No code is executed to classify it. */
export function declarationOnlyManifest(source, path = 'manifest.ts') {
  const value = node => {
    switch (node?.type) {
      case 'Literal': case 'Identifier': return true;
      case 'ObjectExpression': return node.properties.every(property => property.type === 'SpreadElement'
        ? value(property.argument) : property.type === 'Property' && property.kind === 'init' && !property.method
          && !property.computed && value(property.value));
      case 'ArrayExpression': return node.elements.every(element => element === null || value(element));
      case 'SpreadElement': return value(node.argument);
      case 'MemberExpression': return !node.optional && value(node.object)
        && (node.computed ? node.property.type === 'Literal' : node.property.type === 'Identifier');
      case 'UnaryExpression': return ['-', '+'].includes(node.operator) && node.argument.type === 'Literal'
        && typeof node.argument.value === 'number';
      case 'TemplateLiteral': return node.expressions.length === 0;
      case 'TSAsExpression': case 'TSSatisfiesExpression': case 'TSTypeAssertion': return value(node.expression);
      default: return false;
    }
  };
  const statement = node => {
    switch (node.type) {
      case 'ImportDeclaration': return node.importKind === 'type' || node.specifiers.length > 0;
      case 'VariableDeclaration': return node.kind === 'const' && node.declarations.every(row =>
        row.id.type === 'Identifier' && row.init !== null && value(row.init));
      case 'ExportDefaultDeclaration': return value(node.declaration);
      case 'ExportNamedDeclaration': return node.source === null && (node.declaration === null || statement(node.declaration));
      case 'TSInterfaceDeclaration': case 'TSTypeAliasDeclaration': case 'EmptyStatement': return true;
      default: return false;
    }
  };
  return parseSync(path, source).program.body.every(statement);
}

/** G390: measured custom reduction contributes 80 points; tiles plus no private bytes contribute 20.
 * @param {number|null} customPercent @param {{status:string,tiles:{total:number}|null,privateBinaries:readonly string[]}} content
 * @returns {import('./shard-platform.mjs').PortHeadline} */
export function portHeadline(customPercent, content) {
  if (customPercent !== null && (!Number.isFinite(customPercent) || customPercent < 0)) throw new Error('Invalid custom percentage');
  const world = content.status !== 'built' ? 'unavailable' : content.tiles?.total > 0 && content.privateBinaries.length === 0
    ? 'yes' : content.tiles?.total > 0 || content.privateBinaries.length === 0 ? 'partial' : 'no';
  const worldPoints = world === 'yes' ? 20 : world === 'partial' ? 10 : 0;
  return { customPercent, world, percent: world === 'unavailable' || customPercent === null ? null
    : 80 * Math.max(0, Math.min(1, (100 - customPercent) / 80)) + worldPoints };
}
const HEADLINE_SHARDS = [ 'sunscar-dunes', 'far-reach', 'nine-dragon-stack', 'nalati-grasslands', 'driftwood-isle', 'pine-hollow'];
/** @param {Record<string,{port:import('./shard-platform.mjs').PortHeadline}>} rows */
export function portAverage(rows) {
  const values = HEADLINE_SHARDS.map(slug => rows[slug]?.port.percent ?? null);
  return values.some(value => value === null) ? null : values.reduce((sum, value) => sum + (value ?? 0), 0) / values.length;
}
function filesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesIn(path) : sourceFile.test(path) && !path.endsWith('.d.ts') ? [path] : [];
  });
}
function sourceInfo(source, path) {
  if (path.endsWith('.glsl') || path.endsWith('.json')) return { comments: [], specs: [] };
  if (path.endsWith('.as')) {
    const parsed = assembly(source, path);
    return { comments: parsed.comments, specs: parsed.statements
      .filter(node => node.kind === NodeKind.Import || node.kind === NodeKind.Export)
      .flatMap(node => node.path ? [node.path.value] : []) };
  }
  const tree = parseSync(path, source), specs = [];
  for (const row of tree.module.staticImports) specs.push(row.moduleRequest.value);
  for (const row of tree.module.staticExports) for (const entry of row.entries) if (entry.moduleRequest) specs.push(entry.moduleRequest.value);
  // Ordinary imports use the parser's module index. Walk only files with expression/import-type/CommonJS edges.
  if (/\b(?:import|require)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(/u.test(source)
    || tree.program.body.some(node => node.type === 'TSImportEqualsDeclaration')) {
    const add = node => specs.push(node?.type === 'Literal' && typeof node.value === 'string' ? node.value
      : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null);
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (['TSImportType', 'ImportExpression'].includes(node.type) && node.source) add(node.source);
      else if (node.type === 'TSExternalModuleReference') add(node.expression);
      else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') add(node.arguments[0]);
      for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
    };
    visit(tree.program);
  }
  return { comments: tree.comments, specs, tree };
}
// G294 per export: a module's top-level bindings, what each one's declaration references, and how its exports map
// onto them. `refs` holds local names, `ns\0member` for a namespace-import member, and `\0spec` (`\0spec\0name` with an
// import-type qualifier) for an expression or import-type module reference; an empty member evaluates only the module.
// A bare module reference reaches every export. Matching is lexical, without scope analysis.
const MEMBER_KEYS = new Set(['Property', 'MethodDefinition', 'PropertyDefinition', 'AccessorProperty', 'TSPropertySignature',
  'TSMethodSignature', 'TSAbstractMethodDefinition', 'TSAbstractPropertyDefinition', 'TSAbstractAccessorProperty', 'ImportAttribute']);
const OWN_IDS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration', 'ClassExpression', 'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration']);
function moduleSymbols(program) {
  const imports = new Map(), exports = new Map(), stars = [], bindings = new Map(), init = { refs: new Set(), spans: [] }, statics = [];
  const namespaces = new Set();
  const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
    : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0].value.cooked : null;
  const nameOf = node => node?.type === 'Identifier' ? node.name : literal(node);
  for (const node of program.body) if (node.source && /^(?:Import|ExportNamed|ExportAll)Declaration$/u.test(node.type)) statics.push(node.source.value);
  for (const node of program.body) if (node.type === 'ImportDeclaration') for (const spec of node.specifiers) {
    const name = spec.type === 'ImportSpecifier' ? nameOf(spec.imported) : spec.type === 'ImportDefaultSpecifier' ? 'default' : '*';
    imports.set(spec.local.name, { spec: node.source.value, name });
    if (name === '*') namespaces.add(spec.local.name);
  } else if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference') {
    imports.set(node.id.name, { spec: literal(node.moduleReference.expression), name: '*' });
    statics.push(literal(node.moduleReference.expression));
    namespaces.add(node.id.name);
  }
  const patternNames = (node, out) => {
    if (!node) return out;
    if (node.type === 'Identifier') out.push(node.name);
    else if (node.type === 'ObjectPattern') for (const prop of node.properties) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
    else if (node.type === 'ArrayPattern') for (const element of node.elements) patternNames(element, out);
    else if (node.type === 'RestElement') patternNames(node.argument, out);
    else if (node.type === 'AssignmentPattern') patternNames(node.left, out);
    return out;
  };
  const collect = (root, refs) => {
    // A local constant holding import() is a namespace too. Keep its initializer
    // from claiming the whole module when only named members are read. A root
    // binding remains conservative because another module may import that object.
    const dynamicNamespaces = new Map(), boundImports = new Map();
    // The engine retry leaf returns its loader's result unchanged. Recognize
    // only that named import, never an arbitrary wrapper around import().
    const retryBindings = new Set([...imports].filter(([, row]) => row.name === 'retried'
      && /(?:^|\/)engine\/boot\/retry$/u.test(row.spec)).map(([name]) => name));
    const shadows = new Set();
    const findShadows = node => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(findShadows); return; }
      const patterns = node.type === 'VariableDeclarator' ? [node.id] : node.params ?? [];
      for (const pattern of patterns) for (const name of patternNames(pattern, [])) shadows.add(name);
      for (const child of Object.values(node)) if (child && typeof child === 'object') findShadows(child);
    };
    findShadows(root);
    const resolvedValue = input => {
      let value = input, awaited = false;
      while (value) {
        if (value.type === 'ParenthesizedExpression' || value.type === 'AwaitExpression') {
          if (value.type === 'AwaitExpression') awaited = true;
          value = value.expression ?? value.argument;
        } else if (value.type === 'CallExpression' && value.callee.type === 'Identifier'
          && retryBindings.has(value.callee.name) && !shadows.has(value.callee.name) && value.arguments.length === 1
          && value.arguments[0].type === 'ArrowFunctionExpression' && value.arguments[0].params.length === 0
          && value.arguments[0].body.type !== 'BlockStatement') value = value.arguments[0].body;
        else break;
      }
      return { value, awaited };
    };
    const importedValue = input => {
      const { value, awaited } = resolvedValue(input);
      return awaited && value?.type === 'ImportExpression' ? value : null;
    };
    const bindMembers = (pattern, input) => {
      const { value } = resolvedValue(input);
      if (pattern?.type !== 'ObjectPattern' || value?.type !== 'ImportExpression' || literal(value.source) === null) return;
      const members = pattern.properties.map(row => row.type === 'Property'
        ? row.computed ? literal(row.key) : nameOf(row.key) : null);
      if (members.every(name => name !== null)) boundImports.set(value, members);
    };
    const findNamespaces = node => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(findNamespaces); return; }
      if (node.type === 'VariableDeclaration' && node.kind === 'const') for (const row of node.declarations) {
        const value = importedValue(row.init);
        const spec = value?.type === 'ImportExpression' ? literal(value.source) : null;
        if (row !== root && row.id.type === 'Identifier' && spec !== null) {
          if (!dynamicNamespaces.has(row.id.name)) dynamicNamespaces.set(row.id.name, new Set());
          dynamicNamespaces.get(row.id.name).add(spec); boundImports.set(value, []);
        }
      }
      if (node.type === 'VariableDeclarator') {
        bindMembers(node.id, importedValue(node.init));
        // Promise.all preserves literal tuple positions. Narrow each directly
        // destructured namespace independently; rest/unknown keys still escape.
        const resolved = resolvedValue(node.init), call = resolved.awaited ? resolved.value : null;
        if (node.id.type === 'ArrayPattern' && call?.type === 'CallExpression'
          && call.callee.type === 'MemberExpression' && !call.callee.computed
          && call.callee.object.type === 'Identifier' && call.callee.object.name === 'Promise'
          && !imports.has('Promise') && !shadows.has('Promise')
          && call.callee.property.type === 'Identifier' && call.callee.property.name === 'all'
          && call.arguments.length === 1 && call.arguments[0].type === 'ArrayExpression'
          && !call.arguments[0].elements.some(row => row?.type === 'SpreadElement')
          && !node.id.elements.some(row => row?.type === 'RestElement')) {
          for (let i = 0; i < node.id.elements.length; i++) bindMembers(node.id.elements[i], call.arguments[0].elements[i]);
        }
      }
      if (node.type === 'MemberExpression') {
        const value = importedValue(node.object);
        const member = node.computed ? literal(node.property) : nameOf(node.property);
        if (value?.type === 'ImportExpression' && literal(value.source) !== null && member !== null) boundImports.set(value, [member]);
      }
      for (const child of Object.values(node)) if (child && typeof child === 'object') findNamespaces(child);
    };
    findNamespaces(root);
    const namespaceRef = (name, member) => {
      if (namespaces.has(name)) refs.add(member === null ? name : `${name}\0${member}`);
      for (const spec of dynamicNamespaces.get(name) ?? []) refs.add(`\0${spec}${member === null ? '' : `\0${member}`}`);
    };
    const visit = (node, parent, key, binding) => {
      if (node === null || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const child of node) visit(child, parent, key, binding); return; }
      if (typeof node.type !== 'string') return;
      if (node.type === 'Identifier') {
        const skip = binding === true || (key === 'property' && parent.type === 'MemberExpression' && !parent.computed)
          || (key === 'key' && MEMBER_KEYS.has(parent.type) && !parent.computed) || (key === 'right' && parent.type === 'TSQualifiedName')
          || (key === 'label') || (key === 'id' && (parent.type === 'TSEnumMember' || OWN_IDS.has(parent.type)))
          || (key === 'name' && parent.type === 'TSTypeParameter');
        if (!skip) {
          if (dynamicNamespaces.has(node.name)) namespaceRef(node.name, null);
          else refs.add(node.name);
        }
        visit(node.typeAnnotation, node, 'typeAnnotation', false);
        visit(node.decorators, node, 'decorators', false);
        return;
      }
      if (node.type === 'JSXIdentifier') {
        if ((key === 'name' && /^(?:JSXOpening|JSXClosing)Element$/u.test(parent.type)) || (key === 'object' && parent.type === 'JSXMemberExpression')) refs.add(node.name);
        return;
      }
      // Literal member reads are narrow; passing/spreading the object or an
      // unknown computed key still reaches every export through the identifier.
      if (node.type === 'MemberExpression' && node.object.type === 'Identifier'
        && (namespaces.has(node.object.name) || dynamicNamespaces.has(node.object.name))) {
        const member = node.computed ? literal(node.property) : nameOf(node.property);
        if (member !== null) { namespaceRef(node.object.name, member); return; }
      }
      if (node.type === 'TSQualifiedName' && node.left.type === 'Identifier' && namespaces.has(node.left.name)) {
        namespaceRef(node.left.name, node.right.name); return;
      }
      if (node.type === 'ImportExpression' || node.type === 'TSImportType') {
        const spec = literal(node.source), member = node.qualifier?.type === 'Identifier' ? `\0${node.qualifier.name}` : '';
        if (spec !== null) {
          refs.add(`\0${spec}${boundImports.has(node) ? '\0' : member}`);
          for (const name of boundImports.get(node) ?? []) refs.add(`\0${spec}\0${name}`);
        }
        if (node.type === 'TSImportType') { visit(node.typeArguments, node, 'typeArguments', false); return; }
      }
      if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') { const spec = literal(node.arguments[0]); if (spec !== null) refs.add(`\0${spec}`); }
      for (const [childKey, child] of Object.entries(node)) {
        if (childKey === 'type' || childKey === 'start' || childKey === 'end' || childKey === 'range') continue;
        // Binding positions are not references; their defaults, computed keys and type annotations are.
        const childBinding = (childKey === 'id' && node.type === 'VariableDeclarator') || (childKey === 'params' && /Function|Arrow|TSMethodSignature|TSCallSignature|TSConstructSignature|TSFunctionType|TSConstructorType|TSDeclareFunction/u.test(node.type))
          || (childKey === 'param' && node.type === 'CatchClause') || (childKey === 'parameter' && node.type === 'TSParameterProperty')
          || (binding && ((node.type === 'Property' && childKey === 'value') || (node.type === 'RestElement' && childKey === 'argument')
            || (node.type === 'AssignmentPattern' && childKey === 'left') || (node.type === 'ArrayPattern' && childKey === 'elements')
            || (node.type === 'ObjectPattern' && childKey === 'properties')));
        visit(child, node, childKey, childBinding);
      }
    };
    visit(root, null, null, false);
  };
  const bind = (name, span, declaration) => {
    if (!bindings.has(name)) bindings.set(name, { spans: [], refs: new Set() });
    const row = bindings.get(name);
    row.spans.push(span);
    collect(declaration, row.refs);
  };
  const declare = (declaration, statement) => {
    const span = { start: statement.start, end: statement.end };
    if (declaration.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        const names = patternNames(declarator.id, []), own = declaration.declarations.length === 1 ? span : { start: declarator.start, end: declarator.end };
        for (const name of names) bind(name, own, declarator);
      }
      return declaration.declarations.flatMap(row => patternNames(row.id, []));
    }
    if (declaration.type === 'TSModuleDeclaration' && (declaration.id?.type !== 'Identifier' || declaration.kind === 'global')) { collect(declaration, init.refs); init.spans.push(span); return []; }
    if (declaration.type === 'TSImportEqualsDeclaration') { if (!imports.has(declaration.id.name)) bind(declaration.id.name, span, declaration.moduleReference); return [declaration.id.name]; }
    if (declaration.id?.type === 'Identifier') { bind(declaration.id.name, span, declaration); return [declaration.id.name]; }
    return null;
  };
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration' || (node.type === 'TSImportEqualsDeclaration' && imports.has(node.id.name))) continue;
    if (node.type === 'ExportAllDeclaration') {
      if (node.exported === null) stars.push(node.source.value);
      else exports.set(nameOf(node.exported), { spec: node.source.value, name: '*' });
      continue;
    }
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration) for (const name of declare(node.declaration, node) ?? []) exports.set(name, { local: name });
      for (const spec of node.specifiers) exports.set(nameOf(spec.exported), node.source ? { spec: node.source.value, name: nameOf(spec.local) } : { local: nameOf(spec.local) });
      continue;
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const names = /Declaration$|^TSDeclareFunction$/u.test(node.declaration.type) ? declare(node.declaration, node) : null;
      if (names?.length === 1) exports.set('default', { local: names[0] });
      else { bind('\0default', { start: node.start, end: node.end }, node.declaration); exports.set('default', { local: '\0default' }); }
      continue;
    }
    if (node.type === 'TSExportAssignment') { bind('\0default', { start: node.start, end: node.end }, node.expression); exports.set('default', { local: '\0default' }); continue; }
    const names = /Declaration$|^TSDeclareFunction$/u.test(node.type) ? declare(node, node) : null;
    if (names === null) { collect(node, init.refs); init.spans.push({ start: node.start, end: node.end }); }
  }
  return { imports, exports, stars, bindings, init, statics };
}
/** Per line of `source`: does it hold code once parser comment spans are blanked (the codeLines unit)? */
function codeLineMask(source, comments) {
  const chunks = [];
  let cursor = 0;
  for (const { start, end } of comments) {
    chunks.push(source.slice(cursor, start), source.slice(start, end).replaceAll(/[^\n]/gu, ' '));
    cursor = end;
  }
  chunks.push(source.slice(cursor));
  const starts = [0], blanked = chunks.join('');
  for (let index = 0; index < blanked.length; index++) if (blanked[index] === '\n') starts.push(index + 1);
  const code = blanked.split('\n').map(line => line.trim() !== '');
  const lineOf = offset => { let low = 0, high = starts.length - 1; while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid] <= offset) low = mid; else high = mid - 1; } return low; };
  return { code, lineOf };
}
// Cache only syntax-derived facts. Package resolution, user attribution and every gate still run on this tree.
function cachedSourceInfo(source, path, directory, recipe) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const key = hash(`${recipe}\0${path}\0${source}`), file = resolve(directory, `${key}.json`);
  const revive = (_key, value) => value !== null && typeof value === 'object' && Object.hasOwn(value, '$map') ? new Map(value.$map)
    : value !== null && typeof value === 'object' && Object.hasOwn(value, '$set') ? new Set(value.$set) : value;
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof stored.payload === 'string' && hash(stored.payload) === stored.hash) return JSON.parse(stored.payload, revive);
  } catch (error) {
    if (!(error instanceof Error && ('code' in error && error.code === 'ENOENT' || error instanceof SyntaxError))) throw error;
  }
  const parsed = sourceInfo(source, path);
  const facts = { comments: parsed.comments, specs: parsed.specs, shaderLines: rawShaderLines(source, path, parsed.tree?.program),
    symbols: parsed.tree === undefined ? undefined : moduleSymbols(parsed.tree.program) };
  const payload = JSON.stringify(facts, (_key, value) => value instanceof Map ? { $map: [...value] }
    : value instanceof Set ? { $set: [...value] } : value);
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ hash: hash(payload), payload }));
  renameSync(temporary, file);
  return facts;
}

// G473-G477 approvals are explicit feature receipts, separate from G441's
// temporary credit for the current/completed wave. A wave change cannot revoke
// these platform approvals, and an ordinary pending row cannot claim one.
/** @type {Record<string,string>} */
const approvedFeatures = {
  'grass-field':'G478',
  'audio-cue-director':'G478',
  'stealth-and-detection':'G478',
  'mounts-riding-taming':'G478',
  'grapple-traversal':'G478',
  'walk-in-portal-ride':'G478',
  'practice-courses':'G478',
  'H6 ambient life':'G474',
  'light emitters':'G478',
  'eased fields':'G484',
  'declared runtime entry':'G483',
  'contracts + elites':'G473',
  'world scene assembly':'G483',
  'boss fight host':'G474',
  'living-buildings':'G474',
  'weather reactions + keyed sky':'G474', 'quadruped-rig':'G474', 'actor-spawn':'G474',
  'bolt-flight':'G474', 'quest-step-runner':'G474', 'loadout':'G474',
  'streamed-cover':'G475', 'streamed cover':'G475', 'toon look host':'G475', 'painterly look host':'G478', 'collections':'G475', 'held-arms':'G475',
  'water-ripples':'G474', 'colour-ramp-fog':'G475',
  'low-poly-binder':'G475', 'resident-world':'G475',
};
/** @param {import('./shard-platform.mjs').PendingPlatformUser} entry */
function approvedFeature(entry) {
  const approval=entry.approvedFeature;
  return approval!==undefined && approvedFeatures[approval.name]===approval.decision.row;
}
// G419: planned users are an explicit, temporary allowance, never actual import-graph users.
const PendingUsers = v.strictObject({ schema:v.literal('platform-pending-users/1'), entries:v.pipe(v.array(v.strictObject({
  module:v.pipe(producerPath,v.regex(/^src\/(?:engine|game|sdk|sharddev|format)\//u)), export:v.optional(v.string()),
  shard:v.exactOptional(v.picklist(['driftwood-isle','pine-hollow','nalati-grasslands','nine-dragon-stack'])),
  plan:v.exactOptional(v.strictObject({path:v.pipe(producerPath,v.regex(/^docs\/plans\//u)),row:v.string()})),
  documentation:v.pipe(producerPath,v.regex(/^docs\//u)), 'rechecked-by':v.exactOptional(v.literal('end of W3')),
  approvedFeature:v.exactOptional(v.strictObject({name:v.string(),decision:v.strictObject({path:v.literal('docs/plans/decisions.md'),row:v.picklist(['G473','G474','G475','G478','G483','G484'])})})),
})), v.check(rows => rows.every(entry => {
  const complete = entry.shard !== undefined && entry.plan !== undefined && entry['rechecked-by'] !== undefined;
  const empty = entry.shard === undefined && entry.plan === undefined && entry['rechecked-by'] === undefined;
  return complete || (empty && entry.approvedFeature !== undefined);
}), 'A pending user needs its shard, plan and recheck; an approved feature needs only its decision')) });
const unsortedDoc=text=>text.replaceAll(/\b(engine|game)\/(?:client|server|shared|cook)\//gu,'$1/');
/** Read documented general hosts backed by a real future user or an explicit day-one approval.
 * @param {string} root @returns {import('./shard-platform.mjs').PendingPlatformUser[]} */
export function pendingPlatformUsers(root) {
  return readPendingPlatformUsers(root,(path,source)=>moduleSymbols(parseSync(path,source).program));
}
function readPendingPlatformUsers(root,symbolsFor) {
  const file=resolve(root,'lint/platform-pending-users.json');
  if(!existsSync(file))return [];
  const entries=v.parse(PendingUsers,JSON.parse(readFileSync(file,'utf8'))).entries
    .filter(entry => !retiredPlatformModule(entry.module) || existsSync(onDisk(root,entry.module)));
  const seen=new Set();
  const names={'driftwood-isle':'Driftwood','pine-hollow':'Pine','nalati-grasslands':'Nalati','nine-dragon-stack':'Nine'};
  for(const entry of entries){
    const key=`${entry.module}#${entry.export??'*'}:${entry.shard??'approved'}`;
    if(seen.has(key))throw new Error(`Duplicate pending platform user: ${key}`);seen.add(key);
    if(entry.approvedFeature!==undefined){
      if(!approvedFeature(entry))throw new Error(`Unapproved platform feature: ${key}`);
      const decision=entry.approvedFeature.decision;
      if(!readFileSync(resolve(root,decision.path),'utf8').split('\n').some(line=>line.split('|')[1]?.trim()===decision.row))
        throw new Error(`Missing platform feature decision: ${key}`);
    }
    const source=readFileSync(onDisk(root,entry.module),'utf8');
    if(/src\/shards\/|@wildshard\/shards\/|sunscar-dunes|far-reach|driftwood-isle|pine-hollow|nalati-grasslands|nine-dragon-stack/u.test(source))
      throw new Error(`Pending feature names a shard: ${entry.module}`);
    const symbols=symbolsFor(entry.module,source);
    if(entry.export!==undefined&&!symbols.exports.has(entry.export))throw new Error(`Missing pending platform export: ${key}`);
    // A retag moves the file between sides and leaves the doc's row true, so both are read without their side (J122).
    const documentation=unsortedDoc(readFileSync(resolve(root,entry.documentation),'utf8'));
    if(!documentation.includes(unsortedDoc(entry.module.replace(/^src\//u,'').replace(/\.ts$/u,''))))
      throw new Error(`Pending feature lacks documentation: ${key}`);
    if (entry.plan !== undefined && entry.shard !== undefined) {
      const row=readFileSync(resolve(root,entry.plan.path),'utf8').split('\n').find(line=>line.split('|')[1]?.trim()===entry.plan?.row);
      if(!row||!row.includes(names[entry.shard]))throw new Error(`Missing later-wave plan row: ${key}`);
    }
  }
  return entries;
}
/** Separate temporary planned users from the remaining sole-user charges.
 * @param {string} slug
 * @param {import('./shard-platform.mjs').PlatformModuleCharge[]} modules
 * @param {{path:string;name:string;exported:boolean;lines:number}[]} exports
 * @param {import('./shard-platform.mjs').PendingPlatformUser[]} allowances */
export function partitionPendingPlatformUsers(slug,modules,exports,allowances) {
  /** @type {import('./shard-platform.mjs').PendingPlatformCharge[]} */
  const pending=[];
  const charged=(row)=>{
    if (platformChargeback(row.path, 'name' in row ? row.name : undefined) !== null) return true;
    const eligibleWave=SHARD_WAVES.some(wave=>(wave.current||wave.status.startsWith('closed'))&&wave.shards.some(shard=>shard.slug===slug));
    const matches=allowances.filter(entry=>(approvedFeature(entry)||(eligibleWave&&entry.shard!==undefined))&&entry.shard!==slug&&entry.module===row.path
      && (entry.export===undefined||('name' in row&&row.exported&&entry.export===row.name)));
    if(matches.length===0)return true;
    pending.push({...row,status:'pending second user',users:matches});return false;
  };
  const keptModules = modules.filter(charged);
  const keptExports = exports.filter(row => !keptModules.some(module => module.path === row.path)).filter(charged);
  // A one-user module may retain older approved code while its new declarations
  // charge back. Report its pending remainder once, excluding those declarations.
  for (const row of pending) if (!('name' in row)) row.lines -= keptExports.filter(entry => entry.path === row.path).reduce((sum, entry) => sum + entry.lines, 0);
  return {modules:keptModules,exports:keptExports,pending:pending.filter(row => row.lines > 0)};
}

// The application's real composition roots are a consumer, not a shard. Their
// named reach prevents menu/travel/session code from becoming a sole-shard debt.
// Keep this list short: never add content folders or shard-specific installers.
const SHELL_ROOTS = ['src/client/app/entry.ts', 'src/client/game/session/session.ts', 'src/client/game/mainMenu.ts', 'src/client/game/session/loadout.ts'];
const SHELL_USER = '@game-shell';
// Loading a default content catalogue is not using that content in a shard.
// The shell supplies a second user only for these orchestration modules and
// these UI bridge declarations, never species, models, rendering or gameplay.
const SHELL_CONTROL_PREFIXES = ['src/client/game/grid/', 'src/shared/game/grid/', 'src/server/game/grid/', 'src/client/game/session/', 'src/client/game/shard/', 'src/server/game/shard/', 'src/client/game/travel/'];
const SHELL_UI_CONTROL = new Set([
  'gridHome', 'enterGrid', 'bootPageMode', 'dropGridIntent', 'selected', 'refused', 'loop',
  'safeGridRecovery', 'consumeGridRecovery', 'pageGridRecovery', 'clearGridRecovery',
  'gridRecoveryRefused', 'gridRecoveryLoop', 'PageResidencyBoot', 'preparePageResidency',
  'emptyShardfileSource', 'installShardfileProduct', 'selectSource', 'installManifestShardfile',
  'shardfileLevelSpec', 'loadShardfile', 'configuredShardfile', 'installShardfileSource',
]);
/** @param {string} path @param {string|null} [local] */
const shellControl = (path, local = null) => SHELL_CONTROL_PREFIXES.some(prefix => path.startsWith(prefix))
  || (path === 'src/client/game/plugin/ui.ts' && (local === null || SHELL_UI_CONTROL.has(local)));

// Scoped to one immutable census; no policy verdict survives another report.
function censusMemo() {
  return {sources:new Map(),texts:new Map(),graphs:new Map(),probes:new Map(),targets:new Map(),edges:new Map(),
    symbols:new Map(),masks:new Map(),pending:new Map(),authored:new Map()};
}
/** @param {string} root @param {boolean} includeSources @param {string} products @param {string[]} slugs @param {boolean} sourceProgress @param {string} sectionProducts */
function countOutput(root, includeSources, products, slugs, sourceProgress = false, sectionProducts = resolve(root,'out'), memo = censusMemo(), reader = createOutputReader(root,sourceProgress ? sectionProducts : products)) {
  const attributed = path => RULES.attributedLayers.test(path) || platformChargeback(path) !== null || hasChargebackDeclarations(path);
  const platform = path => /^src\/(?:engine|game|sdk|sharddev|commons)\//u.test(path) || attributed(path);
  // One measurement reads one immutable tree: memoize file probes, package targets and edges (pnpm gen, ~3 s).
  const {probes,targets,edges,texts,graphs,sources,masks}=memo;
  const exists = (path) => { let hit = probes.get(path); if (hit === undefined) { hit = existsSync(onDisk(root, path)); probes.set(path, hit); } return hit; };
  const counts = new Map();
  const baselines = shardLineBaselines(root);
  /** @type {Set<string>} */
  const generated = new Set();
  // Retained source tables also have exact producer/output identities; older tooling predates generation jobs.
  const sourceOutputs = 'scripts/source-generation-outputs.json';
  if (exists(sourceOutputs)) {
    const catalogue = v.parse(SourceOutputs, JSON.parse(readFileSync(resolve(root, sourceOutputs), 'utf8')));
    for (const outputs of Object.values(catalogue.producers)) for (const path of outputs) generated.add(path);
  }
  if (sourceProgress) for (const product of shardProducts(root, slugs)) {
    if (!exists(`src/shards/${product.folder}/manifest.json`)) continue;
    const path = productManifestPath(root, product);
    if (!exists(path)) throw new Error(`Source census requires generated discovery: ${path}; restore generation before counting`);
  }
  const text = (path) => {
    if (!texts.has(path)) texts.set(path, readFileSync(onDisk(root, path), 'utf8'));
    return texts.get(path);
  };
  // G458 alone retains the predecessor source-progress reading. It is never an
  // output percentage or a source fallback, and is not available to port badges.
  const sourceData = path => /^src\/shards\/[^/]+\/data\/.*\.tsx?$/u.test(path);
  const ignored = path => sourceProgress ? generated.has(path)&&!sourceData(path)
    : !path.startsWith(`${relative(root, products).replaceAll('\\', '/')}/`) && generated.has(path);
  const parseCache = process.env.WS_SHARD_PARSE_CACHE;
  const parseRecipe = parseCache ? createHash('sha256').update(readFileSync(import.meta.filename)).update(exists('pnpm-lock.yaml') ? text('pnpm-lock.yaml') : '').digest('hex') : '';
  const info = path => { if (!sources.has(path)) sources.set(path, parseCache ? cachedSourceInfo(text(path), path, parseCache, parseRecipe) : sourceInfo(text(path), path)); return sources.get(path); };
  const symbolsOf = path => { if (!memo.symbols.has(path)) memo.symbols.set(path, info(path).symbols ?? moduleSymbols(info(path).tree.program)); return memo.symbols.get(path); };
  if(!memo.pending.has(root))memo.pending.set(root,readPendingPlatformUsers(root,path=>symbolsOf(path)));
  const pendingUsers=memo.pending.get(root), dayOneHosts=g571HostApprovals(root), dayOneMasks=new Map();
  // Named approvals waive only their nonblank declaration lines. A physical
  // line shared with any unapproved declaration stays charged conservatively.
  const dayOneMask = path => {
    if (dayOneMasks.has(path)) return dayOneMasks.get(path);
    const names=dayOneHosts.get(path), selected=new Set(), unapproved=new Set();
    if (names !== undefined && names !== null) {
      const sym=symbolsOf(path);
      for (const name of names) if (!sym.bindings.has(name)) throw new Error(`Missing G571 binding: ${path}#${name}`);
      if (!masks.has(path)) masks.set(path,codeLineMask(text(path),info(path).comments));
      const {code,lineOf}=masks.get(path);
      for (const [name,row] of sym.bindings) for (const span of row.spans)
        for (let line=lineOf(span.start);line<=lineOf(Math.max(span.start,span.end-1));line++)
          if (code[line]) (names.has(name)?selected:unapproved).add(line);
      for (const line of unapproved) selected.delete(line);
    }
    dayOneMasks.set(path,selected);return selected;
  };
  const shaders = path => ignored(path) ? 0 : info(path).shaderLines ?? rawShaderLines(text(path), path, RULES.typescript.test(path) && !path.endsWith('.glsl') ? info(path).tree?.program : undefined);
  const count = path => { if (!counts.has(path)) counts.set(path, ignored(path) ? 0 : (path.endsWith('.json') ? shaders(path) : path.endsWith('.glsl') ? shaderCodeLines(text(path)) : linesWithoutComments(text(path), info(path).comments))); return counts.get(path); };
  const sdk = exists('src/server/host/package.json') ? JSON.parse(text('src/server/host/package.json')) : null;
  const publishedTargetOf = (pkg, spec) => {
    const name = `@wildshard/${pkg}`, manifest = pkg === 'sdk' ? sdk : exists(`src/${pkg}/package.json`) ? JSON.parse(text(`src/${pkg}/package.json`)) : null;
    if (manifest?.name !== name || !(spec === name || spec?.startsWith(`${name}/`))) return null;
    const key = spec === name ? '.' : `.${spec.slice(name.length)}`, target = manifest.exports?.[key];
    const path = typeof target === 'string' ? relative(root, resolve(root, `src/${pkg}`, target)).replaceAll('\\', '/') : null;
    if (sourceProgress && path !== null && generated.has(path) && !exists(path)) throw new Error(`Source census requires generated source: ${path}`);
    return path !== null && exists(path) ? path : null;
  };
  const publishedTarget = (pkg, spec) => {
    const key = `${pkg}\0${String(spec)}`;
    if (!targets.has(key)) targets.set(key, publishedTargetOf(pkg, spec));
    return targets.get(key);
  };
  const resolveEdgeOf = (path, spec) => {
    const pkg = /^@wildshard\/(sdk|sharddev|game|engine|commons)(?:\/|$)/u.exec(spec ?? '');
    const shaderBase = spec?.startsWith('.') ? relative(root, resolve(root, path, '..', spec.split('?')[0])).replaceAll('\\', '/') : null;
    const shaderPath = shaderBase?.endsWith('.glsl') && exists(shaderBase) ? shaderBase : null;
    const to = spec === null ? null : shaderPath ?? (pkg === null ? null : publishedTarget(pkg[1], spec)) ?? resolveSpecifier(path, spec, exists);
    // Local AssemblyScript imports are part of the same authored closure, including extensionless imports.
    const base = spec?.startsWith('.') ? relative(root, resolve(root, path, '..', spec)).replaceAll('\\', '/') : null;
    const assemblyPath = base === null ? null : [base, `${base}.as`, `${base}/index.as`].find((candidate) => candidate.endsWith('.as') && exists(candidate));
    // A local JSON import is data: it resolves to its file, which the folder rules then classify like any other.
    const jsonPath = base !== null && base.endsWith('.json') && exists(base) ? base : null;
    if (sourceProgress && to === null && assemblyPath === undefined && jsonPath === null) {
      const required = base !== null && generated.has(base) ? base : resolveSpecifier(path, spec, candidate => generated.has(candidate));
      if (required !== null && !exists(required)) throw new Error(`Source census requires generated source: ${required} (from ${path})`);
    }
    // Classify the resolved path's namespace components; an audited tree need not contain that namespace.
    const local = (to ?? '').split('/');
    const trustedLocal = local.length > 3 && local[0] === 'src' && local[1] === 'sharddev' && local[2] === 'runtime';
    return { sdk: publishedTarget('sdk', spec) !== null || publishedTarget('sharddev', spec) !== null, trusted: /^@wildshard\/sharddev\/runtime(?:\/|$)/u.test(spec ?? '') || trustedLocal, commons: publishedTarget('commons', spec) !== null, to: to ?? assemblyPath ?? jsonPath ?? null };
  };
  const resolveEdge = (path, spec) => {
    const key = spec === null ? `${path}\0\u0001` : `${path}\0${String(spec)}`;
    if (!edges.has(key)) edges.set(key, resolveEdgeOf(path, spec));
    return edges.get(key);
  };
  const graph = (path) => {
    if (!graphs.has(path)) graphs.set(path, info(path).specs.map(spec => resolveEdge(path, spec)));
    return graphs.get(path);
  };
  if(!memo.authored.has(root))memo.authored.set(root,Object.fromEntries(readdirSync(resolve(root, 'src/shards'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [entry.name, filesIn(resolve(root, 'src/shards', entry.name)).map((path) => relative(root, path))])));
  const authoredFiles=memo.authored.get(root);
  // Build tools are visible debt, never a runtime root or a second runtime user.
  const buildFile = (slug, path) => {
    const prefix = `src/shards/${slug}/`;
    return path.startsWith(prefix) && /^(?:data|generators)\/|^shard\.config\./u.test(path.slice(prefix.length));
  };
  const buildUsers = new Map();
  for (const [slug, files] of Object.entries(authoredFiles)) {
    if (slug === RULES.template) continue;
    const queue = files.filter(path => buildFile(slug, path)), seen = new Set();
    while (queue.length > 0) {
      const path = queue.pop();
      if (seen.has(path) || !exists(path) || !sourceFile.test(path)) continue;
      seen.add(path);
      if (!buildFile(slug, path) && !/^src\/(?:engine|game|sdk|sharddev|commons)\//u.test(path)) continue;
      if (/^src\/(?:sdk|sharddev)\//u.test(path)) {
        if (!buildUsers.has(path)) buildUsers.set(path, new Set());
        buildUsers.get(path).add(slug);
      }
      for (const edge of graph(path)) if (edge.to !== null) queue.push(edge.to);
    }
  }
  // LD10: a built product ships no runtime TypeScript, so the output basis roots only its verified sections (and
  // charges its private section / named JSON bytes); authored runtime files are measured by source progress alone.
  const outputs = Object.fromEntries(slugs.map(slug => {
    const { sections, customSectionBytes, customSections } = reader.sections(slug);
    return [slug, sourceProgress ? {runtime:authoredFiles[slug],sections,customSectionBytes:0,customSections:[]}
      : {runtime:[],sections,customSectionBytes,customSections}];
  }));
  const prefixOf = slug => `${relative(root, resolve(products, representativeProduct(root, slug))).replaceAll('\\', '/')}/`;
  const shardFiles = Object.fromEntries(Object.entries(outputs).map(([slug, output]) => [slug, output.runtime.filter(path => !path.endsWith('.d.ts'))]));
  const hostFiles = new Map();
  for (const [slug, output] of Object.entries(outputs)) {
    const path = `${prefixOf(slug)}.section-hosts.ts`;
    texts.set(path, sectionHostImports(output.sections, sourceProgress ? '../../' : '../../src/')); probes.set(path, true);
    hostFiles.set(slug, path);
  }
  // Source progress still reports the authored inventory, but build-only imports
  // supply no runtime users. A live import into those folders is followed below.
  const runtimeRoots = Object.entries(shardFiles).map(([slug, files]) => [slug, sourceProgress ? files.filter(path => !buildFile(slug, path)) : files]);
  const consumers = [...runtimeRoots.map(([slug, files]) => [slug, hostFiles.has(slug) ? [...files, hostFiles.get(slug)] : files]), [SHELL_USER, SHELL_ROOTS.filter(exists)]];
  const runtimeReached = new Map();
  const moduleUsers = new Map();
  for (const [slug, files] of consumers) {
    // G312: templates are authoring fixtures, never an independent consumer of a platform system.
    const prefix = prefixOf(slug), seen = new Set(), queue = files.filter(path => !RULES.tests.test(path));
    runtimeReached.set(slug, seen);
    while (queue.length > 0) {
      const path = queue.pop();
      if (seen.has(path)) continue;
      seen.add(path);
      if (!sourceFile.test(path) || path.endsWith('.d.ts') || RULES.tests.test(path) || !exists(path)) continue;
      // Other shards are never consumers of this one's closure; follow defining engine modules too (G303).
      if (slug === SHELL_USER ? !path.startsWith('src/') || path.startsWith('src/shards/')
        : !path.startsWith(prefix) && !platform(path)) continue;
      if (slug !== RULES.template && attributed(path) && (slug !== SHELL_USER || shellControl(path))) {
        if (!moduleUsers.has(path)) moduleUsers.set(path, new Set());
        moduleUsers.get(path).add(slug);
      }
      for (const edge of graph(path)) if (edge.to !== null) queue.push(edge.to);
    }
  }
  chargePlatformUsers(moduleUsers, new Map());
  const privateModules = new Map(Object.keys(shardFiles).map(slug => [slug, []]));
  for (const [path, users] of [...moduleUsers].sort(([a], [b]) => a.localeCompare(b))) {
    // This format module enters attribution only for the reviewed arena rows.
    if (path.startsWith('src/format/') && platformChargeback(path) === null) continue;
    if (RULES.buildOnlySdk.test(path) || users.has(SHELL_USER) || users.size >= RULES.publicUserCount || !(RULES.typescript.test(path) || path.endsWith('.glsl'))) continue;
    if (approvedG571Host(dayOneHosts,path)) continue;
    const lines = count(path)-dayOneMask(path).size;
    const excludedLines=[...dayOneMask(path)].map(line=>line+1);
    if (lines > 0) recordPrivateCharge(privateModules, [...users][0], { path, lines, ...(excludedLines.length===0?{}:{excludedLines}) });
  }
  // G294 per export: a module that two or more shards reach as a file still charges every top-level declaration that
  // exactly one shard reaches, through its own imports or transitively through the platform code it reaches.
  const bindingUsers = new Map();
  const parsedTs = path => RULES.typescript.test(path) && !path.endsWith('.d.ts');
  for (const [slug, files] of consumers) {
    if (slug === RULES.template) continue;
    const rootFiles = new Set(files);
    const prefix = prefixOf(slug), seen = new Set(), queue = files.filter(path => !RULES.tests.test(path)).map(path => [path, null]);
    const follow = path => typeof path === 'string' && sourceFile.test(path) && !path.endsWith('.d.ts') && !RULES.tests.test(path) && exists(path)
      && (slug === SHELL_USER ? path.startsWith('src/') && !path.startsWith('src/shards/')
        : path.startsWith(prefix) || platform(path));
    // Resolve an exported name (or `*`, every export) to the local declaration(s) behind it; reaching it evaluates the module.
    const exported = (path, name, stack = new Set()) => {
      if (path === null || !follow(path)) return;
      queue.push([path, null]);
      if (!parsedTs(path) || stack.has(`${path}\0${name}`)) return;
      stack.add(`${path}\0${name}`);
      const sym = symbolsOf(path), rows = name === '*' ? [...sym.exports.values()] : sym.exports.has(name) ? [sym.exports.get(name)] : [];
      for (const row of rows) {
        // `export { imported as name }` forwards to the imported module's export.
        const forward = row.local === undefined ? row : sym.imports.get(row.local);
        if (forward === undefined) queue.push([path, row.local]); else exported(resolveEdge(path, forward.spec).to, forward.name, stack);
      }
      if (name === '*' || rows.length === 0) for (const star of sym.stars) exported(resolveEdge(path, star).to, name, stack);
    };
    const reach = (path, sym, refs) => {
      for (const ref of refs) {
        const [head, member] = ref.split('\0', 2), parts = ref.split('\0');
        if (head === '') {
          const target = resolveEdge(path, parts[1]).to;
          if (parts[2] === '') { if (target !== null) queue.push([target, null]); }
          else exported(target, parts[2] ?? '*');
        }
        else if (member !== undefined) { const row = sym.imports.get(head); if (row) exported(resolveEdge(path, row.spec).to, member); }
        else if (sym.bindings.has(ref)) queue.push([path, ref]);
        else if (sym.imports.has(ref)) { const row = sym.imports.get(ref); exported(resolveEdge(path, row.spec).to, row.name); }
      }
    };
    while (queue.length > 0) {
      const [path, local] = queue.pop(), key = `${path}\0${local ?? ''}`;
      if (seen.has(key) || !follow(path)) continue;
      seen.add(key);
      if (!parsedTs(path)) { for (const row of graph(path)) if (row.to !== null) queue.push([row.to, null]); continue; }
      const sym = symbolsOf(path);
      if (local === null) {
        // Evaluating a module runs its top-level statements and evaluates its static imports.
        for (const spec of sym.statics) { const to = resolveEdge(path, spec).to; if (to !== null) queue.push([to, null]); }
        reach(path, sym, sym.init.refs);
        // The shard's own folder is the root: every declaration, named import and re-export in it is used (a namespace
        // import reaches the members its declarations name, or every export when used bare).
        if (slug === SHELL_USER ? rootFiles.has(path) : path.startsWith(prefix)) {
          for (const name of sym.bindings.keys()) queue.push([path, name]);
          for (const row of sym.imports.values()) if (row.name !== '*') exported(resolveEdge(path, row.spec).to, row.name);
          for (const row of sym.exports.values()) if (row.spec !== undefined) exported(resolveEdge(path, row.spec).to, row.name);
          for (const star of sym.stars) exported(resolveEdge(path, star).to, '*');
        }
        continue;
      }
      const row = sym.bindings.get(local);
      if (row === undefined) continue;
      if (attributed(path) && (slug !== SHELL_USER || shellControl(path, local))) {
        if (!bindingUsers.has(key)) bindingUsers.set(key, new Set());
        bindingUsers.get(key).add(slug);
      }
      reach(path, sym, row.refs);
    }
  }
  chargePlatformUsers(moduleUsers, bindingUsers);
  const inlineSpans = new Map(inlinePlatformPaths().filter(path => moduleUsers.has(path)).map(path => [path, inlinePlatformSpans(path, text(path))]));
  const privateExports = new Map(Object.keys(shardFiles).map(slug => [slug, []]));
  for (const [path, users] of [...moduleUsers].sort(([a], [b]) => a.localeCompare(b))) {
    if (RULES.buildOnlySdk.test(path) || (users.size < RULES.publicUserCount && !hasChargebackDeclarations(path)) || !parsedTs(path) || ignored(path)) continue;
    if (approvedG571Host(dayOneHosts,path)) continue;
    const sym = symbolsOf(path), claimed = new Set([...(inlineSpans.get(path) ?? []).flatMap(span => span.lines),...dayOneMask(path)]);
    if (!masks.has(path)) masks.set(path, codeLineMask(text(path), info(path).comments));
    const { code, lineOf } = masks.get(path), exportedLocals = new Set([...sym.exports.values()].flatMap(row => row.local ?? []));
    const sole = [...sym.bindings].map(([local, row]) => ({ local, row, owners: bindingUsers.get(`${path}\0${local}`) }))
      .filter(entry => entry.owners?.size === 1 && !entry.owners.has(SHELL_USER) && !approvedG571Host(dayOneHosts,path,entry.local)
        && (!path.startsWith('src/format/') || platformChargeback(path, entry.local) !== null)
        && (users.size >= RULES.publicUserCount || platformChargeback(path, entry.local) !== null)).sort((a, b) => a.row.spans[0].start - b.row.spans[0].start);
    for (const { local, row, owners } of sole) {
      let lines = 0;
      for (const span of row.spans) for (let line = lineOf(span.start); line <= lineOf(Math.max(span.start, span.end - 1)); line++) {
        if (!claimed.has(line) && code[line]) { claimed.add(line); lines++; }
      }
      if (lines > 0) recordPrivateCharge(privateExports, [...owners][0], { path, name: local === '\0default' ? 'default' : local, exported: exportedLocals.has(local), lines });
    }
  }
  // Audited branches within shared declarations charge their actual source
  // lines once, excluding them from any surrounding sole-binding charge.
  for (const [path, spans] of inlineSpans) {
    if (!masks.has(path)) masks.set(path, codeLineMask(text(path), info(path).comments));
    const { code } = masks.get(path);
    for (const span of spans) {
      if (approvedG571Host(dayOneHosts,path,span.name)) continue;
      const lines = span.lines.filter(line => code[line] && !dayOneMask(path).has(line)).length;
      if (lines > 0) recordPrivateCharge(privateExports, undefined, { path, name: span.name, exported: false, lines });
    }
  }
  const trustedRuntime = (slug, path) => {
    const prefix = prefixOf(slug), seen = new Set(), queue = [path];
    while (queue.length > 0) {
      const current = queue.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      if (!current.startsWith(prefix)) continue;
      for (const edge of graph(current)) {
        if (edge.trusted) return true;
        if (edge.to?.startsWith(prefix)) queue.push(edge.to);
      }
    }
    return false;
  };
  // SF54 dissolved the kit, so no shard-unique kit lines remain to count as custom (the former kit-only column).
  const out = {}, listedViews = loadListedViews(root);
  for (const [slug, files] of Object.entries(shardFiles)) {
    const row = { runtimeLines: 0, trustedRuntimeLines: 0, assemblyScriptLines: 0, conversion: null };
    let shardRuntimeLines = 0, rawGlslLines = 0, additionalGlslLines = 0;
    const customSources = [], collectSources = includeSources || COMPONENT_SHARDS.includes(slug) || Object.hasOwn(listedViews.shards, slug) && listedViews.shards[slug].length > 0;
    for (const path of files) {
      const local = path.slice(prefixOf(slug).length), top = local.split('/')[0];
      const lines = count(path);
      // G315: authored AS is reported separately, without a cap or an effect on the G291 TS ratio.
      if (path.endsWith('.as') && !RULES.tests.test(local)) row.assemblyScriptLines += lines;
      const sourceOnlyData = sourceProgress && (top==='generators'&&!runtimeReached.get(slug)?.has(path)
        || local==='manifest.ts'&&declarationOnlyManifest(text(path),path)
        || local==='shard.config.ts'&&declarationOnlyConfig(text(path),path)
        || jsonTypeContract(text(path),path)
        || generated.has(path)&&sourceData(path)&&declarationOnlyManifest(text(path),path));
      if (RULES.typescript.test(path) && !RULES.tests.test(local) && !sourceOnlyData) {
        shardRuntimeLines += lines;
        if (collectSources && lines > 0) customSources.push({path, kind:'runtime-ts', lines,
          ownerPath:`src/shards/${slug}/${local}`});
      }
      const shaderLines = RULES.tests.test(local) ? 0 : shaders(path);
      rawGlslLines += shaderLines;
      if (!RULES.typescript.test(path) || sourceOnlyData) {
        additionalGlslLines += shaderLines;
        if (collectSources && shaderLines > 0) customSources.push({path, kind:'additional-glsl', lines:shaderLines});
      }
      const trusted = trustedRuntime(slug, path);
      if (!path.endsWith('.as') && trusted) row.trustedRuntimeLines += lines;
      if (!path.endsWith('.as') && (top === 'runtime' || trusted)) row.runtimeLines += lines;
    }
    {
      // AS remains a separate source visibility column: its shipped executable
      // form is Wasm and never adds TS lines to the runtime numerator.
      row.assemblyScriptLines = authoredFiles[slug].filter(path => path.endsWith('.as') && !RULES.tests.test(path)).reduce((sum, path) => sum + count(path), 0);
      row.customSectionBytes = outputs[slug].customSectionBytes;
      row.customSections = outputs[slug].customSections;
      row.measurement = 'built-output';
      const tools = [...buildUsers].filter(([path, users]) => users.size === 1 && users.has(slug)
        && (RULES.buildOnlySdk.test(path) || !moduleUsers.has(path))).map(([path]) => ({path, lines:count(path), bytes:Buffer.byteLength(text(path))}));
      row.oneUserBuildTools = {lines:tools.reduce((sum, tool) => sum + tool.lines, 0), files:tools};
    }
    const baseline = baselines.get(slug);
    const legacyLines = baseline?.lines ?? null;
    const {modules,exports,pending} = partitionPendingPlatformUsers(slug,privateModules.get(slug),privateExports.get(slug),pendingUsers);
    const attributedLines = [...modules, ...exports].reduce((total, module) => total + module.lines, 0);
    const customRuntimeLines = shardRuntimeLines + additionalGlslLines + attributedLines;
    const asCeiling=legacyLines===null?null:Math.floor(legacyLines/10);
    // G454: a visibility column only; AS does not enter the TS numerator or gate.
    row.assemblyScriptBudget={ceiling:asCeiling,share:legacyLines===null?null:row.assemblyScriptLines/legacyLines,
      passed:asCeiling===null?null:row.assemblyScriptLines<=asCeiling,enforcement:'report-only'};
    row.conversion = {
      metric: baseline === undefined ? 'native' : 'runtime-vs-legacy', customRuntimeLines, shardRuntimeLines, rawGlslLines, additionalGlslLines,
      legacyLines, legacyFolder: baseline === undefined ? null : `${slug}-legacy`, legacyRevision: baseline?.source ?? null,
      runtimeShare: legacyLines === null ? null : customRuntimeLines / legacyLines,
      passed: legacyLines === null ? null : customRuntimeLines === 0, // G604: every shard's target is zero
      gameSystemAttribution: { status: 'import-graph', review: 'G294-primary-reach', lines: attributedLines, modules, exports, pendingSecondUser:pending },
    };
    if (collectSources) {
      for (const module of modules) customSources.push({...module, kind:'sole-module'});
      for (const entry of exports) customSources.push({path:entry.path, lines:entry.lines, name:entry.name, kind:'sole-export'});
      row.listedView = listedViewInventory(root, slug, customSources, customRuntimeLines, listedViews);
      if (includeSources) row.customSources = customSources;
      if (COMPONENT_SHARDS.includes(slug)) row.components = componentInventory(root, slug, customSources, customRuntimeLines);
    }
    row.listedView ??= listedViewInventory(root, slug, [], customRuntimeLines, listedViews);
    out[slug] = row;
  }
  return out;
}
/** Authoritative P4 measure over verified output sections. A missing or corrupt product refuses;
 * authoring files never substitute for missing output or supply G294 users. */
/** @param {string} root @param {boolean} includeSources @param {string} products @param {string[]|null} only */
export function outputShardLines(root = ROOT, includeSources = false, products = resolve(root, 'out'), only = null) {
  const closures = runtimeClosures(root);
  const closed = Object.keys(closures).filter(slug => closures[slug].status === 'closed');
  if (only?.some(slug => !closed.includes(slug))) throw new Error('Output measurement requested an unclosed shard');
  return countOutput(root, includeSources, products, only ?? closed);
}
/** The canonical measure is output-only. Unclosed shards have no row/percentage;
 * runtimeClosures supplies their explicit work queue to reports. */
export function shardLines(root = ROOT, includeSources = false) {
  return outputShardLines(root, includeSources);
}
/** Source-basis progress inventory, including component spans and sole-user charges.
 * Requires every generated product's verified section inventory; never samples a partial out/.
 * Never supplies canonical output percentages for an unclosed shard. */
export function sourceProgressInventory(root = ROOT, products = resolve(root,'out')) {
  const rows=countOutput(root,true,resolve(root,'src/shards'),Object.keys(runtimeClosures(root)),true,products);
  return Object.fromEntries(Object.entries(rows).map(([slug,row])=>[slug,{...row,measurement:'source'}]));
}
/** G458 progress only. The canonical custom percentage remains unavailable for
 * unclosed shards. Preserve the predecessor's source/G294 law for this labelled
 * estimate rather than disguising the output/source unit change as a cut. */
export function sourceProgressLines(root = ROOT, products = resolve(root,'out')) {
  const rows=countOutput(root,false,resolve(root,'src/shards'),Object.keys(runtimeClosures(root)),true,products);
  return progressLines(rows);
}
function progressLines(rows) {
  return Object.fromEntries(Object.entries(rows).map(([slug,row])=>[slug,{basis:'source',
    customLines:row.conversion.customRuntimeLines,legacyLines:row.conversion.legacyLines,
    assemblyScriptLines:row.assemblyScriptLines,assemblyScriptBudget:row.assemblyScriptBudget}]));
}
/** One immutable report shares syntax facts across output and source attribution.
 * Resolution, ownership and components still run separately for both bases.
 * @param {string} root @param {string} products */
export function outputCensus(root = ROOT, products = resolve(root,'out'), reader = createOutputReader(root,products)) {
  const closure=runtimeClosures(root),closed=Object.keys(closure).filter(slug=>closure[slug].status==='closed');
  const memo=censusMemo();
  const measures=countOutput(root,true,products,closed,false,products,memo,reader);
  const rows=countOutput(root,true,resolve(root,'src/shards'),Object.keys(closure),true,products,memo,reader);
  const inventory=Object.fromEntries(Object.entries(rows).map(([slug,row])=>[slug,{...row,measurement:'source'}]));
  return {measures,inventory,source:progressLines(rows)};
}
/** Headless availability is reported separately from the custom/frozen measure. */
export function milestoneFlags(_slug, _row, root = ROOT) {
  return { headless: existsSync(resolve(root, 'test/shard-headless.test.ts')) };
}
export function checkShares(recorded, lines) {
  const failures = [];
  for (const slug of Object.keys(lines)) if (!Object.hasOwn(recorded.baseline, slug)) failures.push(`${slug}: unknown shard (no baseline in ${LIST})`);
  for (const [slug, row] of Object.entries(lines)) {
    if (Object.hasOwn(recorded.enforced, slug) && row.conversion.passed === false) failures.push(`${slug}: custom runtime is not zero (G604)`);
  }
  return failures;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Do not top-level-await this import: the CLI reads this module's exports.
  // The detached async launcher lets evaluation settle before the CLI runs.
  const launch=async()=>{
    try {await Promise.reject(new Error('The shard-platform CLI is sharddev\'s'));}
    catch(error){console.error(error);process.exitCode=1;}
  };
  void launch();
}
