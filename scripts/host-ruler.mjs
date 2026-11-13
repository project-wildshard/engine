#!/usr/bin/env node
// HOST-RULER HR3 (meta docs/plans/HOST-RULER-PLAN.md): the closure each built product reaches, and the modules it alone
// reaches. A product's roots are its HR1 page/section roots (scripts/host-ruler/roots.mjs) and its HR2 server roots
// (scripts/host-ruler/server-roots.mjs). From them the ruler follows static imports and ordinary import()s, but never
// through a dispatch table (TABLES): a table's entries are already rooted per declared kind or host id, so following
// the whole table would make every product a user of every entry (HA0 a, b). Engine self-imports
// (`@wildshard/engine/*`) resolve through engine's package.json exports map. Lines are code lines: nonblank once
// comments are blanked (the old census's codeLines unit). Report-only: nothing here fails a commit.
// Usage: node scripts/host-ruler.mjs --products <product-dir>... [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parseSync } from 'vite';
import { CLIENT_PLAN, ENGINE_ROOT, clientPlanRoots, productRoots, resolveModule } from './host-ruler/roots.mjs';
import { NATIVE_ASSEMBLY, NATIVE_HOSTS, nativeAssemblyRoots, productServerRoots } from './host-ruler/server-roots.mjs';

/** Dispatch tables: a module whose entries a product reaches one by one through its declarations. The module itself
 * runs (its lines count for every product that reaches it); `static` and `dynamic` say which of its own imports are
 * still followed. Explorer dispatch and the chapter facets the plan names are no longer tables in this tree:
 * explorerCatalogue.ts statically builds one catalogue for every product, and the facet owners were retired (G621). */
export const TABLES = Object.freeze({
  // CLIENT_FEATURES: its import()s are the per-kind roots; its static imports are the shared `@client-plan` root.
  [CLIENT_PLAN]: { static: true, dynamic: false },
  // `switch (row.host)`: every case's imports are rooted per declared host id, the shared part as `@native-assembly`.
  [NATIVE_HOSTS]: { static: false, dynamic: false },
  // Its value imports are `@native-assembly`, minus the ones gated on one host id (NATIVE_GATED).
  [NATIVE_ASSEMBLY]: { static: false, dynamic: false },
  // CALLS: the `{$call}` rows a discovery document may name; each look loads only when a product names it.
  'src/client/game/shard/discovery.ts': { static: true, dynamic: false },
});

/** Per line of `source`, whether it holds code once comment spans are blanked.
 * @param {string} source @param {readonly { start: number, end: number }[]} comments */
function codeLineMask(source, comments) {
  const chunks = [];
  let cursor = 0;
  for (const { start, end } of comments) {
    chunks.push(source.slice(cursor, start), source.slice(start, end).replaceAll(/[^\n]/gu, ' '));
    cursor = end;
  }
  chunks.push(source.slice(cursor));
  return chunks.join('').split('\n').map(line => line.trim() !== '');
}
/** Code lines of a TypeScript source: nonblank lines once parser comment spans are blanked.
 * @param {string} source @param {string} [path] */
export function codeLines(source, path = 'measure.ts') {
  return codeLineMask(source, parseSync(path, source).comments).filter(Boolean).length;
}

/** @param {any} pattern @param {string[]} out */
function patternIds(pattern, out) {
  if (pattern === null || pattern === undefined) return out;
  if (pattern.type === 'Identifier') out.push(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties) patternIds(p.type === 'RestElement' ? p.argument : p.value, out);
  else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements) patternIds(e, out);
  else if (pattern.type === 'RestElement') patternIds(pattern.argument, out);
  else if (pattern.type === 'AssignmentPattern') patternIds(pattern.left, out);
  return out;
}
/** Each top-level declaration's names and span, for crediting a register row on one binding.
 * @param {any} program @returns {{ names: string[], start: number, end: number }[]} */
function declarations(program) {
  const out = [];
  for (const statement of program.body) {
    const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (statement.type === 'ExportDefaultDeclaration') { out.push({ names: ['default'], start: statement.start, end: statement.end }); continue; }
    if (node === null || node === undefined) continue;
    if (node.type === 'VariableDeclaration') {
      const one = node.declarations.length === 1;
      for (const d of node.declarations) out.push({ names: patternIds(d.id, []), start: one ? statement.start : d.start, end: one ? statement.end : d.end });
    } else if (node.id?.type === 'Identifier') out.push({ names: [node.id.name], start: statement.start, end: statement.end });
  }
  return out;
}

const FORMAT = '@wildshard/format';
/** A module id: an engine path `src/...`, a format id `@wildshard/format/<package path>`, `npm:<name>`, or a non-code
 * file (`.json`, `?raw`), which is data and counts no lines.
 * @param {string} specifier @param {string} from @param {string} root */
function resolveFrom(specifier, from, root) {
  const bare = specifier.replace(/\?.*$/u, '');
  if (bare.startsWith('.')) {
    const fromFile = from.startsWith(`${FORMAT}/`) ? join('node_modules', from) : from;
    const base = resolve(root, dirname(fromFile), bare);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, 'index.ts')];
    if (/\.[cm]?js$/u.test(base)) candidates.push(base.replace(/\.[cm]?js$/u, '.ts'));
    const file = candidates.find(candidate => existsSync(candidate) && extname(candidate) !== '');
    if (file === undefined) throw new Error(`Unresolved import ${specifier} from ${from}`);
    const path = relative(root, file);
    return path.startsWith(`node_modules/${FORMAT}/`) ? path.slice('node_modules/'.length) : path;
  }
  return resolveModule(bare, from, root);
}

const CODE = /\.(?:[cm]?[jt]sx?)$/u;
/** Read engine's tree (and the pinned format package's) one module at a time, cached.
 * @param {{ root?: string, format?: boolean }} [options] `format` follows `@wildshard/format/*` modules (HR4). */
export function createTreeReader(options = {}) {
  const root = options.root ?? ENGINE_ROOT, followFormat = options.format ?? false;
  /** @type {Map<string, { lines: number, imports: string[], dynamic: string[], declarations: { names: string[], lines: number }[] }>} */
  const cache = new Map();
  /** @param {string} module */
  const followed = module => module.startsWith('src/') || (followFormat && module.startsWith(`${FORMAT}/`));
  return {
    root,
    followed,
    /** @param {string} module */
    read(module) {
      const known = cache.get(module);
      if (known !== undefined) return known;
      const file = module.startsWith(`${FORMAT}/`) ? join(root, 'node_modules', module) : join(root, module);
      if (!CODE.test(module)) { const row = { lines: 0, imports: [], dynamic: [], declarations: [] }; cache.set(module, row); return row; }
      const source = readFileSync(file, 'utf8');
      const parsed = parseSync(module, source);
      if (parsed.errors.length > 0) throw new Error(`${module}: parse errors`);
      const mask = codeLineMask(source, parsed.comments);
      const lineStarts = [0];
      for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
      const lineOf = (/** @type {number} */ offset) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo; };
      const spanLines = (/** @type {number} */ start, /** @type {number} */ end) => { let n = 0; for (let line = lineOf(start); line <= lineOf(Math.max(start, end - 1)); line++) if (mask[line]) n++; return n; };
      /** @type {Set<string>} */
      const imports = new Set();
      // A type-only import or re-export never runs; a side-effect import does.
      for (const row of parsed.module.staticImports) if (row.entries.length === 0 || row.entries.some((/** @type {any} */ e) => !e.isType)) imports.add(resolveFrom(row.moduleRequest.value, module, root));
      for (const row of parsed.module.staticExports) for (const entry of row.entries) if (entry.moduleRequest !== null && !entry.isType) imports.add(resolveFrom(entry.moduleRequest.value, module, root));
      /** @type {Set<string>} */
      const dynamic = new Set();
      for (const row of parsed.module.dynamicImports) {
        const text = source.slice(row.moduleRequest.start, row.moduleRequest.end);
        const literal = /^(['"`])([^'"`$]*)\1$/u.exec(text);
        if (literal === null) throw new Error(`${module}: a non-literal import() the ruler cannot follow: import(${text})`);
        dynamic.add(resolveFrom(literal[2], module, root));
      }
      const row = { lines: mask.filter(Boolean).length, imports: [...imports].sort(), dynamic: [...dynamic].sort(),
        declarations: declarations(parsed.program).map(d => ({ names: d.names, lines: spanLines(d.start, d.end) })) };
      cache.set(module, row);
      return row;
    },
  };
}

/** Every module reached from `roots`: static imports and import()s, except the ones a dispatch table holds back.
 * Modules the reader does not follow (npm packages; format until HR4) end the walk and are not listed.
 * @param {Iterable<string>} roots @param {ReturnType<typeof createTreeReader>} reader @param {Readonly<Record<string, { static: boolean, dynamic: boolean }>>} [tables] */
export function reach(roots, reader, tables = TABLES) {
  /** @type {Set<string>} */
  const seen = new Set();
  const stack = [...roots].filter(module => reader.followed(module));
  while (stack.length > 0) {
    const module = /** @type {string} */ (stack.pop());
    if (seen.has(module)) continue;
    seen.add(module);
    const row = reader.read(module), table = Object.hasOwn(tables, module) ? tables[module] : undefined;
    const next = [...(table?.static === false ? [] : row.imports), ...(table?.dynamic === false ? [] : row.dynamic)];
    for (const target of next) if (!seen.has(target) && reader.followed(target)) stack.push(target);
  }
  return seen;
}

/** The roots of one built product: its page and section roots, its server roots, and the tables it enters.
 * @param {string} dir @param {{ plan?: ReturnType<typeof clientPlanRoots>, native?: ReturnType<typeof nativeAssemblyRoots> }} [tables] */
export function productRootModules(dir, tables = {}) {
  const page = productRoots(dir, tables.plan), server = productServerRoots(dir, tables.native);
  const modules = new Set([...page.modules, ...server.modules].map(row => row.module));
  if (page.sections.includes('client/plan')) modules.add(CLIENT_PLAN);
  if (server.roots.length > 0 || server.unmeasured.length > 0) { modules.add(NATIVE_ASSEMBLY); modules.add(NATIVE_HOSTS); }
  return { slug: page.slug, roots: [...modules].sort(), unmeasured: server.unmeasured };
}

/** Per module, its code lines and the users that reach it.
 * @param {readonly { slug: string, roots: Iterable<string> }[]} users @param {ReturnType<typeof createTreeReader>} reader
 * @param {Readonly<Record<string, { static: boolean, dynamic: boolean }>>} [tables] */
export function measure(users, reader, tables = TABLES) {
  /** @type {Map<string, { lines: number, users: string[] }>} */
  const modules = new Map();
  for (const user of users) for (const module of reach(user.roots, reader, tables)) {
    const row = modules.get(module) ?? { lines: reader.read(module).lines, users: [] };
    if (!row.users.includes(user.slug)) row.users.push(user.slug);
    modules.set(module, row);
  }
  for (const row of modules.values()) row.users.sort();
  return new Map([...modules].sort(([a], [b]) => a.localeCompare(b)));
}

/** Per user: the modules only it reaches, and their lines.
 * @param {ReturnType<typeof measure>} modules @param {readonly string[]} slugs */
export function oneUserLines(modules, slugs) {
  const out = new Map(slugs.map(slug => [slug, { modules: 0, lines: 0 }]));
  for (const row of modules.values()) if (row.users.length === 1) {
    const total = out.get(row.users[0]);
    if (total !== undefined) { total.modules++; total.lines += row.lines; }
  }
  return out;
}

/** Measure built product dirs end to end.
 * @param {readonly string[]} dirs @param {{ root?: string }} [options] */
export function rule(dirs, options = {}) {
  const root = options.root ?? ENGINE_ROOT;
  const tables = { plan: clientPlanRoots(root), native: nativeAssemblyRoots({ root }) };
  const products = dirs.map(dir => productRootModules(dir, tables));
  const slugs = products.map(product => product.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error(`two products share a slug: ${slugs.join(', ')}`);
  const reader = createTreeReader({ root });
  const modules = measure(products, reader);
  return { products, modules, oneUser: oneUserLines(modules, slugs) };
}

/** @param {ReturnType<typeof rule>} report */
export function formatTable(report) {
  const rows = [...report.oneUser].map(([slug, total]) => [slug, String(total.modules), String(total.lines)]);
  const head = ['shard', 'one-user modules', 'one-user lines'];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(row => row[i].length)));
  const line = (/** @type {string[]} */ cells) => `| ${cells.map((cell, i) => i === 0 ? cell.padEnd(width[i]) : cell.padStart(width[i])).join(' | ')} |`;
  const unmeasured = report.products.flatMap(p => p.unmeasured.map(u => `unmeasured: ${p.slug} host ${u.host}: ${u.reason}`));
  return [line(head), `|${width.map((w, i) => i === 0 ? '-'.repeat(w + 2) : `${'-'.repeat(w + 1)}:`).join('|')}|`, ...rows.map(line), ...unmeasured].join('\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2), json = args.includes('--json');
  const at = args.indexOf('--products');
  const dirs = at === -1 ? [] : args.slice(at + 1).filter(arg => !arg.startsWith('--'));
  if (dirs.length === 0) { console.error('usage: node scripts/host-ruler.mjs --products <product-dir>... [--json]'); process.exit(2); }
  const report = rule(dirs);
  if (json) console.log(JSON.stringify({ products: report.products, modules: Object.fromEntries(report.modules) }, null, 2));
  else console.log(formatTable(report));
}
