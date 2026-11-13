#!/usr/bin/env node
// HOST-RULER HR2 (meta docs/plans/HOST-RULER-PLAN.md): the server roots one built product reaches through its
// `server/native-assembly.json`. nativeAssemblyHosts.ts has no table: `prepareAssemblyFeature` is one
// `switch (row.host)` over every native host id, and the file statically imports every host. A product's declared host
// ids root only the imported bindings their own cases use (directly or through the file's helper functions), never the
// whole import list. A case the reader cannot attribute (a name it cannot place, or a local that shadows an import or a
// helper) and a host id with no case print as unmeasured, never as shared.
// nativeAssembly.ts's own value imports are one shared root, `@native-assembly`, reached by every product with a native
// assembly, except the bindings it calls only for one declared host id (NATIVE_GATED), which root under that id.
// Usage: node scripts/host-ruler/server-roots.mjs <product-dir>...   (a dir holding shard.json, e.g. shard-x/out/<slug>)
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseSync } from 'vite';
import { ENGINE_ROOT, resolveModule } from './roots.mjs';

export const NATIVE_HOSTS = 'src/server/game/shardfile/nativeAssemblyHosts.ts';
export const NATIVE_ASSEMBLY = 'src/server/game/shardfile/nativeAssembly.ts';
export const NATIVE_ASSEMBLY_ROOT = '@native-assembly';
export const NATIVE_ASSEMBLY_FILE = 'server/native-assembly.json';
/** nativeAssembly.ts bindings called only when the plan declares one host id (`plan.features.find(row => row.host ===
 * 'encounter.patrol')` reads the patrol's encounter intake). The test checks each is a value import there. */
export const NATIVE_GATED = Object.freeze({ 'encounter.patrol': ['readPatrolIntake', 'readSlotIntake', 'readWindIntake', 'withEncounters'] });
/** Names a case may use that no file declares. Anything else unplaced makes the case unmeasured. */
const GLOBALS = new Set(['undefined', 'Error', 'TypeError', 'Promise', 'Map', 'Set', 'Object', 'Array', 'JSON', 'Math', 'Number', 'String',
  'Boolean', 'structuredClone', 'Float32Array', 'Uint8Array', 'TextDecoder', 'Infinity', 'NaN', 'console']);
const TYPE_KEYS = new Set(['typeAnnotation', 'typeArguments', 'typeParameters', 'returnType', 'superTypeArguments']);
const VALUE_TS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);
/** TS nodes that emit runtime code: the reader refuses them rather than skip them as types. */
const VALUE_DECLARATIONS = new Set(['TSEnumDeclaration', 'TSModuleDeclaration', 'TSImportEqualsDeclaration', 'TSExportAssignment']);

/** @param {string} path @param {string} source */
const parse = (path, source) => {
  const parsed = parseSync(path, source);
  if (parsed.errors.length > 0) throw new Error(`${path}: parse errors`);
  return parsed;
};
/** Value imports of one parsed file: local name -> { module, binding }. Type-only names never run.
 * @param {any} parsed @param {string} from @param {string} root */
function valueImports(parsed, from, root) {
  /** @type {Map<string, { module: string, binding: string }>} */
  const names = new Map();
  for (const row of parsed.module.staticImports) {
    const module = resolveModule(row.moduleRequest.value, from, root);
    if (row.entries.length === 0) throw new Error(`${from}: side-effect import ${row.moduleRequest.value} is no binding a host can be charged`);
    for (const entry of row.entries) {
      if (entry.isType) continue;
      const binding = entry.importName.kind === 'Name' ? entry.importName.name : entry.importName.kind === 'Default' ? 'default' : '*';
      names.set(entry.localName.value, { module, binding });
    }
  }
  return names;
}

/** Names a binding pattern declares, and the references inside it (defaults, computed keys).
 * @param {any} node @param {Set<string>} decls @param {Set<string>} refs */
function declare(node, decls, refs) {
  if (node === null || node === undefined) return;
  if (node.type === 'Identifier') decls.add(node.name);
  else if (node.type === 'ObjectPattern') for (const p of node.properties) {
    if (p.type === 'RestElement') declare(p.argument, decls, refs);
    else { if (p.computed) collect(p.key, refs, decls); declare(p.value, decls, refs); }
  }
  else if (node.type === 'ArrayPattern') for (const e of node.elements) declare(e, decls, refs);
  else if (node.type === 'RestElement') declare(node.argument, decls, refs);
  else if (node.type === 'AssignmentPattern') { declare(node.left, decls, refs); collect(node.right, refs, decls); }
  else throw new Error(`unread binding pattern ${node.type}`);
}
/** Every identifier a subtree reads (refs) and every name it declares (decls). Type positions are skipped: a type
 * never runs. Scopes are flattened: a declared name anywhere in the subtree counts for all of it.
 * @param {any} node @param {Set<string>} refs @param {Set<string>} decls */
function collect(node, refs, decls) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) collect(child, refs, decls); return; }
  if (typeof node.type !== 'string') return;
  switch (node.type) {
    case 'Identifier': refs.add(node.name); return;
    case 'MemberExpression': collect(node.object, refs, decls); if (node.computed) collect(node.property, refs, decls); return;
    case 'Property': case 'PropertyDefinition': case 'MethodDefinition':
      if (node.computed) collect(node.key, refs, decls); collect(node.value, refs, decls); return;
    case 'VariableDeclarator': declare(node.id, decls, refs); collect(node.init, refs, decls); return;
    case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
      if (node.id) decls.add(node.id.name);
      for (const param of node.params) declare(param.type === 'TSParameterProperty' ? param.parameter : param, decls, refs);
      collect(node.body, refs, decls); return;
    case 'CatchClause': declare(node.param, decls, refs); collect(node.body, refs, decls); return;
    case 'LabeledStatement': collect(node.body, refs, decls); return;
    case 'BreakStatement': case 'ContinueStatement': return;
    case 'ImportExpression': throw new Error('an import() the reader cannot attribute');
    default:
  }
  if (VALUE_DECLARATIONS.has(node.type)) throw new Error(`a ${node.type} the reader cannot attribute`);
  if (node.type.startsWith('TS')) { if (VALUE_TS.has(node.type)) collect(node.expression, refs, decls); return; }
  for (const [key, value] of Object.entries(node)) if (!TYPE_KEYS.has(key) && value !== null && typeof value === 'object') collect(value, refs, decls);
}
/** @param {any} node */
const scan = node => { const refs = new Set(), decls = new Set(); collect(node, refs, decls); return { refs, decls }; };

/** Read nativeAssemblyHosts.ts and nativeAssembly.ts statically: per host id, the imported bindings its case uses.
 * @param {{ root?: string, hosts?: { path: string, source: string }, assembly?: { path: string, source: string } }} [input] */
export function nativeAssemblyRoots(input = {}) {
  const root = input.root ?? ENGINE_ROOT;
  const hostsPath = input.hosts?.path ?? NATIVE_HOSTS, hostsSource = input.hosts?.source ?? readFileSync(join(root, NATIVE_HOSTS), 'utf8');
  const parsed = parse(hostsPath, hostsSource), imports = valueImports(parsed, hostsPath, root);
  /** @type {Map<string, any>} */
  const helpers = new Map();
  /** @type {any} */
  let dispatcher = null;
  const topLevel = { refs: new Set(), decls: new Set() };
  for (const statement of parsed.program.body) {
    const node = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
    if (node === null || node.type === 'ImportDeclaration') continue;
    if (VALUE_DECLARATIONS.has(node.type)) throw new Error(`${hostsPath}: a top-level ${node.type} the reader cannot attribute`);
    if (node.type.startsWith('TS')) continue;
    if (node.type === 'FunctionDeclaration') {
      if (node.id.name === 'prepareAssemblyFeature') dispatcher = node; else helpers.set(node.id.name, node);
      continue;
    }
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        const init = d.init?.type === 'TSAsExpression' || d.init?.type === 'TSSatisfiesExpression' ? d.init.expression : d.init;
        // A named top-level value (function or not) is charged to the cases that read it, like a helper function.
        if (d.id.type === 'Identifier' && init !== null && init !== undefined) helpers.set(d.id.name, init);
        else collect(d, topLevel.refs, topLevel.decls);
      }
      continue;
    }
    collect(node, topLevel.refs, topLevel.decls);
  }
  if (dispatcher === null) throw new Error(`${hostsPath}: no prepareAssemblyFeature`);
  const switches = dispatcher.body.body.filter((/** @type {any} */ s) => s.type === 'SwitchStatement');
  const [table] = switches;
  if (switches.length !== 1 || table.discriminant.type !== 'MemberExpression' || table.discriminant.property.name !== 'host') throw new Error(`${hostsPath}: prepareAssemblyFeature has no one switch (row.host)`);
  // Names in scope for every case: the dispatcher's parameters and the statements before its switch.
  const preamble = { refs: new Set(), decls: new Set() };
  for (const param of dispatcher.params) declare(param, preamble.decls, preamble.refs);
  for (const statement of dispatcher.body.body) if (statement !== table) collect(statement, preamble.refs, preamble.decls);
  /** @param {string} name */
  const shadows = name => imports.has(name) || helpers.has(name);

  /** Per helper: the imports it reaches (through other helpers too), and the names it could not place. */
  /** @type {Map<string, { bindings: Set<string>, unplaced: Set<string> }>} */
  const helperReach = new Map();
  // One object, so the two mutually recursive walkers can name each other.
  const reader = {
    /** @param {string} name @param {Set<string>} stack @returns {{ bindings: Set<string>, unplaced: Set<string> }} */
    helper(name, stack) {
      const known = helperReach.get(name);
      if (known !== undefined) return known;
      // No helper recurses today; a cycle would cache a partial reach, so it refuses.
      if (stack.has(name)) throw new Error(`${hostsPath}: helper ${name} is recursive, the reader cannot attribute it`);
      /** @type {{ bindings: Set<string>, unplaced: Set<string> }} */
      const out = { bindings: new Set(), unplaced: new Set() };
      const own = scan(helpers.get(name));
      stack.add(name);
      for (const decl of own.decls) if (decl !== name && shadows(decl)) out.unplaced.add(`${decl} (shadows an import or helper in ${name})`);
      for (const ref of own.refs) reader.place(ref, own.decls, out, stack);
      stack.delete(name);
      helperReach.set(name, out);
      return out;
    },
    /** @param {string} ref @param {Set<string>} decls @param {{ bindings: Set<string>, unplaced: Set<string> }} out @param {Set<string>} stack */
    place(ref, decls, out, stack) {
      if (imports.has(ref)) out.bindings.add(ref);
      else if (helpers.has(ref)) { const reached = reader.helper(ref, stack); for (const b of reached.bindings) out.bindings.add(b); for (const u of reached.unplaced) out.unplaced.add(u); }
      else if (!decls.has(ref) && !preamble.decls.has(ref) && !topLevel.decls.has(ref) && !GLOBALS.has(ref)) out.unplaced.add(ref);
    },
  };
  const reachOf = (/** @type {any} */ node, /** @type {Set<string>} */ inScope) => {
    const own = scan(node), out = { bindings: new Set(), unplaced: new Set() };
    for (const decl of own.decls) if (shadows(decl)) out.unplaced.add(`${decl} (shadows an import or helper)`);
    const decls = new Set([...own.decls, ...inScope]);
    for (const ref of own.refs) reader.place(ref, decls, out, new Set());
    return out;
  };

  /** @type {Map<string, { bindings: Set<string>, unplaced: Set<string> }>} */
  const cases = new Map();
  /** @type {string[]} */
  let pending = [];
  for (const branch of table.cases) {
    if (branch.test === null) { // default: an unknown id throws at prepare time.
      if (pending.length > 0) throw new Error(`${hostsPath}: ${pending.join(', ')} fall through to default`);
      continue;
    }
    if (branch.test.type !== 'Literal' || typeof branch.test.value !== 'string') throw new Error(`${hostsPath}: a case with a non-literal host id`);
    pending.push(branch.test.value);
    if (branch.consequent.length === 0) continue; // falls through to the next case's body.
    const reach = reachOf(branch.consequent, new Set());
    for (const id of pending) {
      if (cases.has(id)) throw new Error(`${hostsPath}: host id ${id} has two cases`);
      cases.set(id, reach);
    }
    pending = [];
  }
  const sharedHosts = reachOf([...preamble.refs].map(name => ({ type: 'Identifier', name })), new Set());
  for (const ref of topLevel.refs) reader.place(ref, topLevel.decls, sharedHosts, new Set());
  if (sharedHosts.unplaced.size > 0) throw new Error(`${hostsPath}: unplaced names outside the switch: ${[...sharedHosts.unplaced].join(', ')}`);

  // nativeAssembly.ts: its value imports are the shared root, but for the bindings gated on one host id.
  const assemblyPath = input.assembly?.path ?? NATIVE_ASSEMBLY, assemblySource = input.assembly?.source ?? readFileSync(join(root, NATIVE_ASSEMBLY), 'utf8');
  const assemblyImports = valueImports(parse(assemblyPath, assemblySource), assemblyPath, root);
  /** @type {Map<string, Set<string>>} */
  const gated = new Map();
  for (const [id, names] of Object.entries(NATIVE_GATED)) for (const name of names) {
    if (!assemblyImports.has(name)) throw new Error(`${assemblyPath}: NATIVE_GATED names ${name}, not a value import there`);
    gated.set(name, (gated.get(name) ?? new Set()).add(id));
  }
  /** @param {Map<string, { module: string, binding: string }>} from @param {Iterable<string>} names */
  const group = (from, names) => {
    /** @type {Map<string, Set<string>>} */
    const byModule = new Map();
    for (const name of names) { const { module, binding } = /** @type {{ module: string, binding: string }} */ (from.get(name)); byModule.set(module, (byModule.get(module) ?? new Set()).add(binding)); }
    return [...byModule].map(([module, bindings]) => ({ module, bindings: [...bindings].sort() })).sort((a, b) => a.module.localeCompare(b.module));
  };
  const attributed = new Set([...cases.values()].flatMap(reach => Array.from(reach.bindings)).concat(Array.from(sharedHosts.bindings)));
  return {
    // The dispatcher itself is the table, not a user (HA0 a): its cases are the per-host roots, so it is not shared.
    shared: [...group(assemblyImports, [...assemblyImports.keys()].filter(name => !gated.has(name) && assemblyImports.get(name)?.module !== hostsPath)), ...group(imports, sharedHosts.bindings)],
    hosts: new Map([...cases].sort(([a], [b]) => a.localeCompare(b)).map(([id, reach]) => [id, {
      roots: [...group(imports, reach.bindings), ...group(assemblyImports, [...gated].filter(([, ids]) => ids.has(id)).map(([name]) => name))],
      unplaced: [...reach.unplaced].sort(),
    }])),
    /** Imported value bindings no case, helper or shared code reaches: dead imports, or a use the reader missed. */
    unattributed: [...imports.keys()].filter(name => !attributed.has(name)).sort(),
    imports: imports.size,
  };
}

/** The server roots one product reaches from its declared host ids. An id with no case, or a case the reader could not
 * attribute, is listed in `unmeasured` and roots nothing.
 * @param {{ slug: string, hosts: readonly string[] | null }} product @param {ReturnType<typeof nativeAssemblyRoots>} [table] */
export function serverRootsFrom(product, table = nativeAssemblyRoots()) {
  /** @type {{ from: string, module: string, bindings: string[] }[]} */
  const roots = [];
  /** @type {{ host: string, reason: string }[]} */
  const unmeasured = [];
  const hosts = product.hosts === null ? [] : [...new Set(product.hosts)];
  if (product.hosts !== null) for (const row of table.shared) roots.push({ from: NATIVE_ASSEMBLY_ROOT, ...row, bindings: [...row.bindings] });
  for (const id of hosts) {
    const entry = table.hosts.get(id);
    if (entry === undefined) { unmeasured.push({ host: id, reason: `no case in ${NATIVE_HOSTS}` }); continue; }
    if (entry.unplaced.length > 0) { unmeasured.push({ host: id, reason: `unplaced names: ${entry.unplaced.join(', ')}` }); continue; }
    for (const row of entry.roots) roots.push({ from: `host:${id}`, ...row, bindings: [...row.bindings] });
  }
  /** @type {Map<string, Set<string>>} */
  const modules = new Map();
  for (const row of roots) { const names = modules.get(row.module) ?? new Set(); for (const name of row.bindings) names.add(name); modules.set(row.module, names); }
  return { slug: product.slug, hosts, roots, unmeasured,
    modules: [...modules].map(([module, names]) => ({ module, bindings: [...names].sort() })).sort((a, b) => a.module.localeCompare(b.module)) };
}

/** Read a built product dir: shard.json's `admission.server` row named `server/native-assembly.json` (as the engine's
 * product readers do, `productData.ts`), then its features' host ids.
 * A product without one reaches no server roots.
 * @param {string} dir @param {ReturnType<typeof nativeAssemblyRoots>} [table] */
export function productServerRoots(dir, table = nativeAssemblyRoots()) {
  const shard = JSON.parse(readFileSync(join(dir, 'shard.json'), 'utf8'));
  const slug = typeof shard.identity?.slug === 'string' ? shard.identity.slug : basename(resolve(dir));
  const row = (Array.isArray(shard.admission?.server) ? shard.admission.server : []).find((/** @type {any} */ file) => file.name === NATIVE_ASSEMBLY_FILE);
  if (row === undefined) return serverRootsFrom({ slug, hosts: null }, table);
  const plan = JSON.parse(readFileSync(join(dir, row.path), 'utf8'));
  if (!Array.isArray(plan.features)) throw new Error(`${dir}: ${NATIVE_ASSEMBLY_FILE} has no features list`);
  plan.features.forEach((/** @type {any} */ feature, /** @type {number} */ i) => { if (typeof feature?.host !== 'string') throw new Error(`${dir}: feature ${i} has no host`); });
  return serverRootsFrom({ slug, hosts: plan.features.map((/** @type {any} */ feature) => feature.host) }, table);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) { console.error('usage: node scripts/host-ruler/server-roots.mjs <product-dir>...'); process.exit(2); }
  const table = nativeAssemblyRoots();
  console.log(JSON.stringify(dirs.map(dir => productServerRoots(dir, table)), null, 2));
}
