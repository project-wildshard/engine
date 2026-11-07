import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { serialize, deserialize } from 'node:v8';
import { parseSync } from 'vite';

const object = (value) => value !== null && typeof value === 'object';
const unwrap = (node) => { let current = node; while (current?.expression) current = current.expression; return current; };
const literal = (node) => unwrap(node)?.value;
const field = (node, key) => unwrap(node)?.properties?.find((property) => (property.key?.name ?? property.key?.value) === key)?.value;
function walk(node, visit, scope = null) {
  if (!object(node)) return;
  const current = ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type) ? node : scope;
  if (typeof node.type === 'string') visit(node, current);
  for (const [key, value] of Object.entries(node)) if (key !== 'parent') {
    if (Array.isArray(value)) { for (const child of value) walk(child, visit, current); }
    else if (object(value)) walk(value, visit, current);
  }
}
// Collect syntax once; evaluate after traversal so imports/definitions retain
// their original whole-program resolution, including declarations after calls.
function debugSyntax(program) {
  const names = new Set(['parsePlumbing']), directors = new Set(['directorVariant']), variants = new Set(['runtimeVariantEnabled']), actions = new Set(['registerGlobalDebugAction']);
  const definitions = new Map(), calls = [], authored = [], additions = [];
  const registries = new Set(), namespaces = new Set();
  const aliases = new Map([['parsePlumbing', names], ['directorVariant', directors], ['runtimeVariantEnabled', variants], ['registerGlobalDebugAction', actions]]);
  const scopes = new Map();
  walk(program, (node, scope) => {
    if (scope !== null) scopes.set(node, scope);
    if (node.type === 'ImportDeclaration' && /(?:^|\/)authoredDebugRows(?:\.[cm]?[jt]s)?$/u.test(node.source?.value ?? '')) {
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportSpecifier' && (specifier.imported?.name ?? specifier.imported?.value) === 'authoredRows') registries.add(specifier.local.name);
        if (specifier.type === 'ImportNamespaceSpecifier') namespaces.add(specifier.local.name);
      }
    }
    if (node.type === 'ImportSpecifier') aliases.get(node.imported?.name)?.add(node.local.name);
    if (node.type === 'VariableDeclarator') {
      definitions.set(node.id?.name, node.init);
      if (node.id?.name === 'DEBUG_ROWS') authored.push(node);
    }
    if (node.type === 'CallExpression') {
      if (node.callee?.type === 'Identifier') calls.push(node);
      if (node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'debugRow' && node.callee.object?.name !== 'adapters') authored.push(node);
      if (node.callee?.type === 'MemberExpression' && (node.callee.property?.name ?? node.callee.property?.value) === 'add') additions.push(node);
    }
  });
  // Resolve imports after the walk, just like named row definitions. An
  // unrelated Set.add is not a Debug declaration, even if its shape matches.
  const isRegistry = (input, seen = new Set()) => {
    const registry = unwrap(input);
    if (registry?.type === 'Identifier') {
      if (registries.has(registry.name)) return true;
      if (seen.has(registry.name)) return false;
      seen.add(registry.name);
      return isRegistry(definitions.get(registry.name), seen);
    }
    return registry?.type === 'MemberExpression' && (registry.property?.name ?? registry.property?.value) === 'authoredRows'
      && registry.object?.type === 'Identifier' && namespaces.has(registry.object.name);
  };
  const forwardsSpec = node => {
    const input = unwrap(node.arguments[0]);
    const value = input?.type === 'Identifier' ? unwrap(definitions.get(input.name)) : input;
    const parameters = new Set(scopes.get(node)?.params.filter(param => param.type === 'Identifier').map(param => param.name));
    // ctx.debugRow/plumbing already counts a generic adapter's declarations.
    // Only unchanged identity/approval fields from one actual parameter are
    // forwarding; a literal extra registration inside that adapter still counts.
    let parameter;
    for (const key of ['id', 'ask', 'reviewBy']) {
      const member = unwrap(field(value, key));
      if (member?.type !== 'MemberExpression' || member.object?.type !== 'Identifier'
        || !parameters.has(member.object.name) || (member.property?.name ?? member.property?.value) !== key
        || parameter !== undefined && parameter !== member.object.name) return false;
      parameter = member.object.name;
    }
    return true;
  };
  for (const node of additions) if (isRegistry(node.callee.object) && !forwardsSpec(node)) authored.push(node);
  return {names, directors, variants, actions, definitions, calls, authored};
}
function declaredFromSyntax({names, directors, variants, actions, calls}) {
  const rows = [];
  for (const node of calls) {
    if (directors.has(node.callee.name)) { if (node.arguments[1] !== undefined) rows.push(node.arguments[1]); continue; }
    // DEBUG_ROWS is already counted at its defining declaration; inline runtime variants need their own inventory.
    if (variants.has(node.callee.name)) { if (unwrap(node.arguments[1])?.type === 'ObjectExpression') rows.push(node.arguments[1]); continue; }
    if (actions.has(node.callee.name)) { if (unwrap(node.arguments[0])?.type === 'ObjectExpression') rows.push(node.arguments[0]); continue; }
    if (!names.has(node.callee.name)) continue;
    const declared = unwrap(field(node.arguments[0], 'debug'));
    if (declared === undefined) continue;
    if (declared.type !== 'ArrayExpression' || declared.elements.some((value) => value === null || value.type === 'SpreadElement')) throw new Error('Declared Debug rows must be a literal array');
    rows.push(...declared.elements);
  }
  return rows;
}
/** Literal rows in admitted plumbing data are inventoried instead of the generic adapter's callback argument. */
export function declaredDebugRows(program) {
  return declaredFromSyntax(debugSyntax(program));
}
/** Read authored rows without executing the game or loading its renderer.
 * @param {string} root @param {string} [cacheDir] Verified per-file facts only; the file inventory stays fresh. */
function inventoryDebugFlags(root, cacheDir, sourceOnly = false) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const recipe = cacheDir === undefined ? null : hash(JSON.stringify([
    process.version, process.versions.v8, process.platform, process.arch,
    hash(readFileSync(new URL('debug-flags.mjs', import.meta.url))),
    ...[resolve(root, 'pnpm-lock.yaml'), new URL('../node_modules/vite/package.json', import.meta.url)]
      .map(file => existsSync(file) ? hash(readFileSync(file)) : null),
  ]));
  const supported = values => Array.isArray(values) && values.every(value => value !== null
    && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).every(key => ['id', 'ask', 'reviewBy', 'purpose'].includes(key))
    && Object.values(value).every(item => item === null || ['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof item)));
  let parsedFiles = 0, reusedFiles = 0;

  const rows = [];
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, entry.name);
      // The SDK ships copied clients and author templates here; their defining sources are inventoried instead.
      if (entry.isDirectory()) { if (file !== resolve(root, 'src/sharddev/dist')) scan(file); continue; }
      if (!/\.[cm]?[jt]sx?$/u.test(file) || sourceOnly && /\.generated\.[cm]?[jt]sx?$/u.test(file)) continue;
      const source = readFileSync(file, 'utf8');
      const key = recipe === null ? null : hash(JSON.stringify([recipe, relative(root, file), source]));
      const receipt = key === null ? null : resolve(cacheDir, 'debug-file-facts', `${key}.json`);
      if (receipt !== null) {
        try {
          const saved = JSON.parse(readFileSync(receipt, 'utf8'));
          if (saved.key !== key || typeof saved.payload !== 'string' || saved.digest !== hash(JSON.stringify([key, saved.payload]))) throw new Error('Corrupt Debug facts');
          const facts = deserialize(Buffer.from(saved.payload, 'base64'));
          if (!supported(facts)) throw new Error('Invalid Debug facts');
          for (const value of facts) rows.push({ ...value, file });
          reusedFiles++; continue;
        } catch { /* Missing or corrupt evidence requires actual parsing. */ }
      }
      const parsed = parseSync(file, source), fileRows = [];
      parsedFiles++;
      if (parsed.errors.length > 0) throw new Error(`Cannot inventory Debug rows in ${file}`);
      const syntax = debugSyntax(parsed.program), definitions = syntax.definitions;
      const row = (value) => {
        const node = unwrap(value);
        if (node?.type === 'Identifier') return row(definitions.get(node.name));
        if (node?.type === 'CallExpression') {
          const options = node.arguments.find((argument) => field(argument, 'ask'));
          return { id: literal(node.arguments[0]), ask: literal(field(options, 'ask')), reviewBy: literal(field(options, 'reviewBy')),
            ...(field(options, 'purpose') ? { purpose: literal(field(options, 'purpose')) } : {}) };
        }
        if (node?.type === 'ObjectExpression') {
          const spread = node.properties.find((property) => property.type === 'SpreadElement');
          return { ...(spread ? row(spread.argument) : {}),
            ...(field(node, 'id') ? { id: literal(field(node, 'id')) } : {}),
            ...(field(node, 'ask') ? { ask: literal(field(node, 'ask')) } : {}),
            ...(field(node, 'reviewBy') ? { reviewBy: literal(field(node, 'reviewBy')) } : {}),
            ...(field(node, 'purpose') ? { purpose: literal(field(node, 'purpose')) } : {}) };
        }
        throw new Error(`Unresolvable Debug row in ${file}`);
      };
      for (const value of declaredFromSyntax(syntax)) fileRows.push(row(value));
      for (const node of syntax.authored) {
        if (node.type === 'VariableDeclarator' && node.id?.name === 'DEBUG_ROWS') {
          const array = unwrap(node.init);
          if (array?.type !== 'ArrayExpression' || array.elements.some((element) => !element || element.type === 'SpreadElement')) throw new Error(`DEBUG_ROWS must be a literal row array: ${file}`);
          for (const value of array.elements) fileRows.push(row(value));
        }
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && node.callee.property?.name === 'debugRow' && node.callee.object?.name !== 'adapters') fileRows.push(row(node.arguments[0]));
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression' && (node.callee.property?.name ?? node.callee.property?.value) === 'add') fileRows.push(row(node.arguments[0]));
      }
      // Preserve undefined fields exactly; unsupported values stay uncached.
      if (receipt !== null && supported(fileRows)) {
        const payload = serialize(fileRows).toString('base64');
        mkdirSync(resolve(receipt, '..'), { recursive: true });
        writeFileSync(receipt, JSON.stringify({ key, payload, digest: hash(JSON.stringify([key, payload])) }));
      }
      for (const value of fileRows) rows.push({ ...value, file });
    }
  }
  scan(resolve(root, 'src'));
  if (cacheDir !== undefined) console.log(`Debug facts: ${parsedFiles} parsed, ${reusedFiles} verified`);
  return rows;
}
/** Full current-tree census; every generated file and current policy still participate.
 * @param {string} root @param {string} [cacheDir] */
export function debugFlags(root, cacheDir) {
  return inventoryDebugFlags(root, cacheDir);
}
/** Prepare exact syntax facts only for immutable source while generation runs.
 * Never returns rows or a verdict; the final full census handles generated code.
 * @param {string} root @param {string} cacheDir */
export function primeDebugFlagFacts(root, cacheDir) {
  inventoryDebugFlags(root, cacheDir, true);
}
