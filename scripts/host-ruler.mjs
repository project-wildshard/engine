#!/usr/bin/env node
// HOST-RULER (meta docs/plans/HOST-RULER-PLAN.md): the closure each built product reaches, and the modules it alone
// reaches. A product's roots are its HR1 page/section roots (scripts/host-ruler/roots.mjs) and its HR2 server roots
// (scripts/host-ruler/server-roots.mjs).
// HR3: from them the ruler follows static imports and ordinary import()s, but never through a dispatch table (TABLES):
// a table's entries are already rooted per declared kind or host id, so following the whole table would make every
// product a user of every entry (HA0 a, b). Engine self-imports (`@wildshard/engine/*`) resolve through engine's
// package.json exports map. Lines are code lines: nonblank once comments are blanked (the old census's codeLines unit).
// HR4: the shell (the app entry with no product loaded) is a user only of the modules SHELL_CONTROL names, not of
// whole folders (HA0 d); `@wildshard/format/*` modules resolve through the pinned format package's exports map and are
// charged like any host, reported under `format`, published files only (HA0 e).
// Report-only: nothing here fails a commit.
// Usage: node scripts/host-ruler.mjs --products <product-dir>... [--json]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { parseSync } from 'vite';
import { CLIENT_PLAN, ENGINE_ROOT, clientPlanRoots, productRoots, resolveModule } from './host-ruler/roots.mjs';
import { NATIVE_ASSEMBLY, NATIVE_HOSTS, nativeAssemblyRoots, productServerRoots } from './host-ruler/server-roots.mjs';
import { REGISTER, readHostRegister } from './host-ruler/register.mjs';

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

/** The shell: the app entry with no product loaded. */
export const SHELL = '@shell';
export const SHELL_ROOTS = Object.freeze(['src/client/app/entry.ts']);
/** The modules the shell is a user of: orchestration it runs for every shard (grid, session, shard loading, travel).
 * Named one by one, replacing SHELL_CONTROL_PREFIXES' seven folders (shard-platform.mjs:634): a new module in those
 * folders is charged to its shard until someone adds it here. Seeded 2026-11-13 from the folder rule's reach: the
 * modules in those folders (and plugin/ui.ts, whose bridge declarations the old rule named) that the shell reaches and a
 * built product reaches. Never add species, models, looks or gameplay. The test checks the shell reaches each one. */
export const SHELL_CONTROL = Object.freeze([
  'src/client/game/grid/assetResidency.ts', 'src/client/game/grid/entryDownloads.ts', 'src/client/game/grid/farImpostorView.ts',
  'src/client/game/grid/farView.ts', 'src/client/game/grid/frameLook.ts', 'src/client/game/grid/intent.ts', 'src/client/game/grid/menu.ts',
  'src/client/game/grid/nearGrain.ts', 'src/client/game/grid/nearPlaceholderPlan.ts', 'src/client/game/grid/nearPlaceholderView.ts',
  'src/client/game/grid/pageEntry.ts', 'src/client/game/grid/pageResidency.ts', 'src/client/game/grid/productInputs.ts',
  'src/client/game/grid/skinEnvelope.ts', 'src/client/game/grid/tileDecoder.ts', 'src/client/game/grid/titlePrefetchChoice.ts',
  'src/client/game/plugin/ui.ts',
  'src/client/game/session/clockSettings.ts', 'src/client/game/session/hudAccent.ts',
  'src/client/game/shard/declaredPlumbing.ts', 'src/client/game/shard/declaredTargets.ts', 'src/client/game/shard/declaredUi.ts',
  'src/client/game/shard/list.ts', 'src/client/game/shard/manifest.ts', 'src/client/game/shard/registry.ts',
  'src/client/game/shard/retainedHooks.ts', 'src/client/game/shard/scopedRuntime.ts', 'src/client/game/shard/spec.ts',
  'src/client/game/shard/titleList.ts',
  'src/client/game/travel/travel.ts',
  'src/shared/game/grid/allocator.ts', 'src/shared/game/grid/assembly.ts', 'src/shared/game/grid/catalogue.ts',
  'src/shared/game/grid/catalogueDocument.ts', 'src/shared/game/grid/catalogueSlot.ts', 'src/shared/game/grid/cellEvents.ts',
  'src/shared/game/grid/farProxy.ts', 'src/shared/game/grid/instances.ts', 'src/shared/game/grid/pageMode.ts',
  'src/shared/game/grid/recovery.ts', 'src/shared/game/grid/roadLayout.ts', 'src/shared/game/grid/roadRecovery.ts',
  'src/shared/game/grid/rules.ts',
]);

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

export const FORMAT = '@wildshard/format';
/** A glob of package.json `files` as a regex over package paths: `**` any depth, `*` one segment. @param {string} glob */
const globRegex = glob => new RegExp(`^${glob.replace(/\/$/u, '/**').replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`).replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*')}$`, 'u');
/** The pinned format package: its dir, its exports map and its published `files` (HR4: only published files count).
 * @param {string} dir */
export function formatPackage(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const files = /** @type {string[]} */ (manifest.files ?? []);
  const include = files.filter(glob => !glob.startsWith('!')).map(globRegex), exclude = files.filter(glob => glob.startsWith('!')).map(glob => globRegex(glob.slice(1)));
  return {
    dir,
    version: /** @type {string} */ (manifest.version),
    exports: /** @type {Record<string, unknown>} */ (manifest.exports ?? {}),
    /** Whether a package path (`src/format/stealth.ts`) is a published file. */
    published: (/** @type {string} */ path) => include.some(re => re.test(path)) && !exclude.some(re => re.test(path)),
  };
}

/** A module id: an engine path `src/...`, a format id `@wildshard/format/<package path>`, `npm:<name>`, or a non-code
 * file (`.json`, `.css`, `?raw`), which is data and counts no lines. Engine self-imports and format imports resolve
 * through their package's exports map; a format file the package does not publish refuses.
 * @param {string} specifier @param {string} from @param {string} root @param {ReturnType<typeof formatPackage>} format */
function resolveFrom(specifier, from, root, format) {
  const bare = specifier.replace(/\?.*$/u, '');
  /** @param {string} file */
  const id = file => {
    const inFormat = relative(format.dir, file);
    if (inFormat.startsWith('..')) return relative(root, file);
    if (!format.published(inFormat)) throw new Error(`${from} imports ${specifier}: ${inFormat} is not a published file of ${FORMAT}`);
    return `${FORMAT}/${inFormat}`;
  };
  if (bare.startsWith('.')) {
    const fromFile = from.startsWith(`${FORMAT}/`) ? join(format.dir, from.slice(FORMAT.length + 1)) : join(root, from);
    const base = resolve(dirname(fromFile), bare);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, 'index.ts')];
    if (/\.[cm]?js$/u.test(base)) candidates.push(base.replace(/\.[cm]?js$/u, '.ts'));
    const file = candidates.find(candidate => existsSync(candidate) && extname(candidate) !== '');
    if (file === undefined) throw new Error(`Unresolved import ${specifier} from ${from}`);
    return id(file);
  }
  if (bare.startsWith(`${FORMAT}/`)) {
    const target = format.exports[`./${bare.slice(FORMAT.length + 1)}`];
    if (typeof target !== 'string') throw new Error(`Unresolved import ${specifier} from ${from}: not in ${FORMAT} exports`);
    return id(join(format.dir, target));
  }
  return resolveModule(bare, from, root);
}

/** @typedef {{ lines: number, imports: string[], dynamic: string[], opaque: string[], declarations: { names: string[], lines: number }[] }} ModuleFacts */
const CODE = /\.[cm]?[jt]sx?$/u;
/** Read engine's tree and the pinned format package one module at a time, cached.
 * @param {{ root?: string, format?: boolean, formatDir?: string }} [options] `format: false` stops at format modules
 * (HR3's reading); by default they are followed and charged like any host (HR4). */
export function createTreeReader(options = {}) {
  const root = options.root ?? ENGINE_ROOT, followFormat = options.format ?? true;
  const format = formatPackage(options.formatDir ?? join(root, 'node_modules', FORMAT));
  /** @type {Map<string, ModuleFacts>} */
  const cache = new Map();
  /** @param {string} module */
  const followed = module => module.startsWith('src/') || (followFormat && module.startsWith(`${FORMAT}/`));
  return {
    root,
    format,
    followed,
    /** @param {string} module @returns {ModuleFacts} */
    read(module) {
      const known = cache.get(module);
      if (known !== undefined) return known;
      if (!CODE.test(module)) { const row = { lines: 0, imports: [], dynamic: [], opaque: [], declarations: [] }; cache.set(module, row); return row; }
      const file = module.startsWith(`${FORMAT}/`) ? join(format.dir, module.slice(FORMAT.length + 1)) : join(root, module);
      const source = readFileSync(file, 'utf8');
      const parsed = parseSync(module, source);
      if (parsed.errors.length > 0) throw new Error(`${module}: parse errors`);
      const mask = codeLineMask(source, parsed.comments);
      const lineStarts = [0];
      for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
      const lineOf = (/** @type {number} */ offset) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; } return lo; };
      const spanLines = (/** @type {number} */ start, /** @type {number} */ end) => { let n = 0; for (let line = lineOf(start); line <= lineOf(Math.max(start, end - 1)); line++) if (mask[line]) n++; return n; };
      const to = (/** @type {string} */ specifier) => resolveFrom(specifier, module, root, format);
      /** @type {Set<string>} */
      const imports = new Set();
      // A type-only import or re-export never runs; a side-effect import does.
      for (const row of parsed.module.staticImports) if (row.entries.length === 0 || row.entries.some((/** @type {any} */ e) => !e.isType)) imports.add(to(row.moduleRequest.value));
      for (const row of parsed.module.staticExports) for (const entry of row.entries) if (entry.moduleRequest !== null && !entry.isType) imports.add(to(entry.moduleRequest.value));
      /** @type {Set<string>} */
      const dynamic = new Set();
      /** @type {string[]} */
      const opaque = [];
      for (const row of parsed.module.dynamicImports) {
        const text = source.slice(row.moduleRequest.start, row.moduleRequest.end);
        const literal = /^(['"`])([^'"`$]*)\1$/u.exec(text);
        // A computed import() (a built bundle's URL, a page's own script) loads no source module: listed, not followed.
        if (literal === null) opaque.push(text);
        else dynamic.add(to(literal[2]));
      }
      const row = { lines: mask.filter(Boolean).length, imports: [...imports].sort(), dynamic: [...dynamic].sort(), opaque,
        declarations: declarations(parsed.program).map(d => ({ names: d.names, lines: spanLines(d.start, d.end) })) };
      cache.set(module, row);
      return row;
    },
  };
}

/** The report layer of a module: `format` for the format package, else its side-first layer (`client/game`, ...).
 * @param {string} module */
export const layerOf = module => module.startsWith(`${FORMAT}/`) ? 'format' : /^src\/(\w+\/\w+)\//u.exec(module)?.[1] ?? 'other';

/** Every module reached from `roots`: static imports and import()s, except the ones a dispatch table holds back.
 * Modules the reader does not follow (npm packages) end the walk and are not listed.
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

/** Per module, its code lines, layer and the users that reach it. The shell, when given, is a user only of the
 * `control` modules it reaches (HR4).
 * @param {readonly { slug: string, roots: Iterable<string> }[]} users @param {ReturnType<typeof createTreeReader>} reader
 * @param {{ tables?: Readonly<Record<string, { static: boolean, dynamic: boolean }>>, shell?: { roots: Iterable<string>, control: readonly string[] } }} [options] */
export function measure(users, reader, options = {}) {
  const tables = options.tables ?? TABLES;
  /** @type {Map<string, { lines: number, layer: string, users: string[] }>} */
  const modules = new Map();
  for (const user of users) for (const module of reach(user.roots, reader, tables)) {
    const row = modules.get(module) ?? { lines: reader.read(module).lines, layer: layerOf(module), users: [] };
    if (!row.users.includes(user.slug)) row.users.push(user.slug);
    modules.set(module, row);
  }
  if (options.shell !== undefined) {
    const shell = reach(options.shell.roots, reader, tables);
    for (const module of options.shell.control) if (shell.has(module)) modules.get(module)?.users.push(SHELL);
  }
  for (const row of modules.values()) row.users.sort();
  return new Map([...modules].sort(([a], [b]) => a.localeCompare(b)));
}

/** Per product: the modules only it reaches, their lines, and how many of those lines are format modules.
 * @param {ReturnType<typeof measure>} modules @param {readonly string[]} slugs */
export function oneUserLines(modules, slugs) {
  const out = new Map(slugs.map(slug => [slug, { modules: 0, lines: 0, format: 0 }]));
  for (const row of modules.values()) if (row.users.length === 1) {
    const total = out.get(row.users[0]);
    if (total === undefined) continue;
    total.modules++;
    total.lines += row.lines;
    if (row.layer === 'format') total.format += row.lines;
  }
  return out;
}

/** HR6's verdict on a span of one-user lines. `platform` and `pending` are credited (pending only until its recheck);
 * the rest are charged to the user: `no-row` ("one-user host, no register row"), `charged-back` (pending or
 * borderline past recheck) and `silly`. */
export const STATUSES = /** @type {const} */ (['platform', 'pending', 'no-row', 'charged-back', 'silly']);
const CREDITED = new Set(['platform', 'pending']);
const PLATFORM_VERDICTS = new Set(['engine', 'game']);
/** @param {{ verdict: string, recheck?: string } | undefined} row @param {string} today */
const statusOf = (row, today) => {
  if (row === undefined) return 'no-row';
  if (PLATFORM_VERDICTS.has(row.verdict)) return 'platform';
  if (row.verdict === 'silly') return 'silly';
  return row.recheck !== undefined && row.recheck >= today ? 'pending' : 'charged-back';
};

/** The platform rule (HA0 f) and the register's gates. A module with two or more real users (products, or the shell
 * on a named control module) is platform. A one-user module is charged to its user unless a register row credits it: an
 * `engine`/`game` row with a decision is platform; a `pending`/`borderline` row is credited until its `recheck` date and
 * charged back after it; a `silly` row is charged. A `module#binding` row decides that binding's declaration lines,
 * the module's own row (or none) the rest. A `silly` row on a shared module charges its lines to the row's users that
 * reach it. A platform verdict without a decision id refuses. Report-only until Jake says otherwise.
 * @param {ReturnType<typeof measure>} modules @param {ReturnType<typeof createTreeReader>} reader
 * @param {readonly { key: string, verdict: string, decision?: string, users: readonly string[], recheck?: string }[]} rows
 * @param {{ today: string }} options `today` as YYYY-MM-DD */
export function applyRegister(modules, reader, rows, options) {
  /** @type {Map<string, typeof rows[number]>} */
  const byModule = new Map();
  /** @type {Map<string, Map<string, typeof rows[number]>>} */
  const byBinding = new Map();
  for (const row of rows) {
    if (PLATFORM_VERDICTS.has(row.verdict) && !/^[GJ]\d+$/u.test(row.decision ?? '')) throw new Error(`host register: ${row.key} is ${row.verdict} (platform) without a decision id`);
    const [module = '', binding] = row.key.split('#');
    if (binding === undefined) byModule.set(module, row);
    else byBinding.set(module, (byBinding.get(module) ?? new Map()).set(binding, row));
  }
  /** @type {Map<string, { module: string, user: string, lines: number, layer: string, spans: Record<string, number>, rows: string[] }>} */
  const charged = new Map();
  /** @type {{ module: string, users: string[], lines: number, key: string }[]} */
  const sillyShared = [];
  for (const [module, use] of modules) {
    const bindings = byBinding.get(module) ?? new Map(), own = byModule.get(module);
    if (use.users.length !== 1) {
      for (const row of [own, ...bindings.values()]) if (row?.verdict === 'silly') {
        const binding = row.key.split('#')[1];
        const lines = binding === undefined ? use.lines : reader.read(module).declarations.filter(d => d.names.includes(binding)).reduce((sum, d) => sum + d.lines, 0);
        sillyShared.push({ module, users: row.users.filter(user => use.users.includes(user)), lines, key: row.key });
      }
      continue;
    }
    /** @type {Record<string, number>} */
    const spans = Object.fromEntries(STATUSES.map(status => [status, 0]));
    let rest = use.lines;
    if (bindings.size > 0) for (const declaration of reader.read(module).declarations) {
      const row = declaration.names.map(name => bindings.get(name)).find(found => found !== undefined);
      if (row === undefined) continue;
      spans[statusOf(row, options.today)] += declaration.lines;
      rest -= declaration.lines;
    }
    spans[statusOf(own, options.today)] += rest;
    charged.set(module, { module, user: use.users[0], lines: use.lines, layer: use.layer, spans,
      rows: [own, ...bindings.values()].filter(row => row !== undefined).map(row => row.key) });
  }
  return { modules: charged, sillyShared };
}

/** Per product: one-user lines without register credit, and what the register credits or charges of them.
 * @param {ReturnType<typeof applyRegister>} ruled @param {readonly string[]} slugs */
export function shardTotals(ruled, slugs) {
  const out = new Map(slugs.map(slug => [slug, { modules: 0, lines: 0, format: 0, ...Object.fromEntries(STATUSES.map(status => [status, 0])), charged: 0 }]));
  for (const row of ruled.modules.values()) {
    const total = /** @type {Record<string, number> | undefined} */ (out.get(row.user));
    if (total === undefined) continue;
    total.modules++;
    total.lines += row.lines;
    if (row.layer === 'format') total.format += row.lines;
    for (const status of STATUSES) {
      total[status] += row.spans[status];
      if (!CREDITED.has(status)) total.charged += row.spans[status];
    }
  }
  for (const row of ruled.sillyShared) for (const user of row.users) {
    const total = /** @type {Record<string, number> | undefined} */ (out.get(user));
    if (total !== undefined) { total.silly += row.lines; total.charged += row.lines; }
  }
  return out;
}

/** Today in Cancún time (the register's recheck dates are Cancún days). */
const cancunToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Cancun' }).format(new Date());

/** Measure built product dirs end to end, with the shell, the pinned format package and the host register.
 * @param {readonly string[]} dirs @param {{ root?: string, today?: string, register?: readonly any[] }} [options] */
export function rule(dirs, options = {}) {
  const root = options.root ?? ENGINE_ROOT, today = options.today ?? cancunToday();
  const tables = { plan: clientPlanRoots(root), native: nativeAssemblyRoots({ root }) };
  const products = dirs.map(dir => productRootModules(dir, tables));
  const slugs = products.map(product => product.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error(`two products share a slug: ${slugs.join(', ')}`);
  const reader = createTreeReader({ root });
  const modules = measure(products, reader, { shell: { roots: SHELL_ROOTS, control: SHELL_CONTROL } });
  const ruled = applyRegister(modules, reader, options.register ?? readHostRegister(root).rows, { today });
  return { products, format: reader.format.version, today, modules, ruled, oneUser: oneUserLines(modules, slugs), totals: shardTotals(ruled, slugs) };
}

/** @param {ReturnType<typeof rule>} report */
export function formatTable(report) {
  const columns = /** @type {const} */ ([['modules', 'one-user modules'], ['lines', 'one-user lines'], ['format', 'of which format'], ['platform', 'credited'],
    ['pending', 'pending'], ['no-row', 'no row'], ['charged-back', 'charged back'], ['silly', 'silly'], ['charged', 'charged']]);
  const rows = [...report.totals].map(([slug, total]) => [slug].concat(columns.map(([key]) => String(/** @type {Record<string, number>} */ (total)[key]))));
  const head = ['shard', ...columns.map(([, name]) => name)];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map(row => row[i].length)));
  const line = (/** @type {string[]} */ cells) => `| ${cells.map((cell, i) => i === 0 ? cell.padEnd(width[i]) : cell.padStart(width[i])).join(' | ')} |`;
  const noRow = [...report.ruled.modules.values()].filter(row => row.spans['no-row'] > 0)
    .sort((a, b) => a.user.localeCompare(b.user) || a.module.localeCompare(b.module))
    .map(row => `one-user host, no register row: ${row.user} ${row.module} (${row.spans['no-row']} lines)`);
  const unmeasured = report.products.flatMap(p => p.unmeasured.map(u => `unmeasured: ${p.slug} host ${u.host}: ${u.reason}`));
  return [`format package ${FORMAT} ${report.format}; register ${REGISTER}; today ${report.today}`,
    'one-user lines without register credit: "one-user lines"; with it: "charged" (no row + charged back + silly)',
    line(head), `|${width.map((w, i) => i === 0 ? '-'.repeat(w + 2) : `${'-'.repeat(w + 1)}:`).join('|')}|`, ...rows.map(line), ...noRow, ...unmeasured].join('\n');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2), json = args.includes('--json');
  const at = args.indexOf('--products'), todayAt = args.indexOf('--today');
  const dirs = at === -1 ? [] : args.slice(at + 1).filter((arg, i, all) => !arg.startsWith('--') && all.slice(0, i).every(prev => !prev.startsWith('--')));
  if (dirs.length === 0) { console.error('usage: node scripts/host-ruler.mjs --products <product-dir>... [--today YYYY-MM-DD] [--json]'); process.exit(2); }
  const report = rule(dirs, todayAt === -1 ? {} : { today: args[todayAt + 1] });
  if (json) console.log(JSON.stringify({ format: report.format, today: report.today, products: report.products, modules: Object.fromEntries(report.modules),
    oneUser: Object.fromEntries(report.ruled.modules), sillyShared: report.ruled.sillyShared, totals: Object.fromEntries(report.totals) }, null, 2));
  else console.log(formatTable(report));
}
