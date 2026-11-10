#!/usr/bin/env node
// SPLIT-REPAIR SR12 (meta docs/plans/SPLIT-REPAIR-PLAN.md): the standing guard for the split's one mistake. The flip moved
// combat to the server, so page listeners stayed compiled and green while their producer left the page, and unit tests
// kept passing because they emit the event by hand. `check:listeners` is J148's socket allowlist; this is
// `pnpm check:page-events`.
//
// Every subscription in src/client and src/shared needs a row in lint/page-events.json naming a production producer and
// the proof that drives it for real:
//   - a literal `.on('<event>', fn)`, on any receiver (the page bus, ctx, a scope's events, a host bus in shared code);
//   - a dynamic `.on(<expr>, fn)` on any receiver, whose event comes from data or a forwarder;
//   - a callback tap: an assignment of `.onKill`, `.onWindup`, `.onDamage` or `.onSound`, or `tap(x, '<tap>', ...)`.
// `.on(ref, 'click', fn)` (a string second argument) is the panel/DOM API, not an event bus, and clearing a tap to
// undefined or null installs nothing.
// A row is { id, kind, name, bus, listeners: [file], producers: [{ file, emits }], proof, why?, debt? }. It is red when:
//   - a listener has no row for its kind, name and file (a new listener);
//   - a row's listener file no longer subscribes there (a stale row: drop the file);
//   - a producer's file is gone, or its `emits` text no longer appears in its code (comments do not count);
//   - a producer is not reachable from its bus's production entries: neither its file, by the runtime import closure,
//     nor each named function around its `emits`, by a reference in that closure. The page closure never crosses into
//     src/server and never follows a worker URL (another realm, another bus), so a producer that moved to the server's
//     bus is not a page producer. A src/client listener is always on a `page` row;
//   - a proof is neither `flow:<name>` that worker-client-proof dispatches, `local`, nor an existing repo script.
// What this proves is that a production producer still exists and is wired by name; that it fires for the listener is
// the proof flow's job. `local` is allowed only when every producer is src/client code: page and listener share a
// process, the case the split could not break. `debt` names an open finding or a missing proof on its row: the check
// prints the count and stays green. `ignore` rows name a site that is not a game-event listener and say why.
//   node scripts/check-page-events.mjs           check (exit 1 on any red line)
//   node scripts/check-page-events.mjs --list    every listener site found, one per line
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';

export const TABLE = 'lint/page-events.json';
export const TAPS = ['onKill', 'onWindup', 'onDamage', 'onSound'];
/** @type {('page' | 'host')[]} */
export const BUSES = ['page', 'host'];
export const RUNNER = 'scripts/worker-client-proof.mjs';
const KINDS = ['event', 'dynamic', 'tap'];
const SCANNED = ['src/client', 'src/shared'];
const SOURCE = /\.(?:ts|tsx|mts)$/u;

/** @param {string} path */
export const isTestPath = path => /\.(?:test|proof)\.m?[jt]sx?$/u.test(path) || /\.d\.m?ts$/u.test(path)
  || /^(?:src\/)?test\//u.test(path) || /(?:^|\/)(?:fixtures?|fake|__tests__)\//u.test(path);

/** @param {string} root @param {string} dir @returns {string[]} repo-relative source files under dir */
function walk(root, dir) {
  const out = /** @type {string[]} */ ([]), base = join(root, dir);
  if (!existsSync(base)) return out;
  for (const entry of readdirSync(base)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(base, entry), rel = relative(root, path).split(sep).join('/');
    if (statSync(path).isDirectory()) out.push(...walk(root, rel));
    else if (SOURCE.test(entry)) out.push(rel);
  }
  return out;
}

/** @param {string} root @param {string} file */
const parse = (root, file) => ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true,
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** @param {ts.Node} node @returns {string | null} a string literal's text */
const literal = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
/** @param {ts.Node} node @returns {string | null} the member a property or literal element access names */
const member = node => ts.isPropertyAccessExpression(node) ? node.name.text
  : ts.isElementAccessExpression(node) ? literal(node.argumentExpression) : null;
/** @param {ts.Node} node */
const isFunction = node => ts.isArrowFunction(node) || ts.isFunctionExpression(node);
/** @param {ts.Node} node */
const isNothing = node => node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined');

/**
 * @typedef {{ file: string, line: number, kind: 'event' | 'dynamic' | 'tap', name: string }} Site
 * @param {ts.SourceFile} source @returns {Site[]}
 */
export function sitesIn(source) {
  /** @type {Site[]} */
  const sites = [];
  const file = source.fileName, line = (/** @type {ts.Node} */ node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  /** @param {ts.Node} node */
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression, [first, second] = node.arguments;
      if (member(callee) === 'on' && first !== undefined && (second === undefined || literal(second) === null)) {
        const name = literal(first), receiver = /** @type {ts.PropertyAccessExpression | ts.ElementAccessExpression} */ (callee).expression;
        if (name !== null && name !== '') sites.push({ file, line: line(node), kind: 'event', name });
        else if (name === null && !isFunction(first) && second !== undefined) {
          sites.push({ file, line: line(node), kind: 'dynamic', name: receiver.getText(source).replaceAll(/\s+/gu, '').replace(/\?$/u, '') });
        }
      }
      const tapName = second === undefined ? null : literal(second);
      if (((ts.isIdentifier(callee) && callee.text === 'tap') || member(callee) === 'tap') && tapName !== null && TAPS.includes(tapName)) sites.push({ file, line: line(node), kind: 'tap', name: tapName });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && !isNothing(node.right)) {
      const name = member(node.left);
      if (name !== null && TAPS.includes(name)) sites.push({ file, line: line(node), kind: 'tap', name });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

/** @param {string} root @returns {Site[]} every listener site in src/client and src/shared, test files excluded */
export function scanListeners(root) {
  return SCANNED.flatMap(dir => walk(root, dir)).filter(file => !isTestPath(file)).sort().flatMap(file => sitesIn(parse(root, file)));
}

/** @param {string} root @returns {Record<string, string>} package export specifier -> repo-relative file */
function exportMap(root) {
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return {};
  const { name = '', exports = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(exports)) if (typeof value === 'string') out[`${name}/${key.replace(/^\.\//u, '')}`] = value.replace(/^\.\//u, '');
  return out;
}

/** @param {string} root @param {string} from @param {string} spec @param {Record<string, string>} exported @returns {string | null} */
function resolveSpec(root, from, spec, exported) {
  const target = spec.startsWith('.') ? relative(root, resolve(root, dirname(from), spec)).split(sep).join('/')
    : spec.startsWith('/') ? spec.slice(1) : exported[spec] ?? null;
  if (target === null) return null;
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, target.replace(/\.js$/u, '.ts')]) {
    const path = join(root, candidate);
    if (existsSync(path) && statSync(path).isFile()) return candidate;
  }
  return null;
}

/** @param {string} root @param {string} from @param {string} pattern @returns {string[]} files an import.meta.glob pattern names */
function globbed(root, from, pattern) {
  const full = relative(root, resolve(root, dirname(from), pattern.replace(/^!/u, ''))).split(sep).join('/');
  const slash = full.lastIndexOf('/'), dir = full.slice(0, slash), leaf = full.slice(slash + 1);
  if (dir.includes('*')) throw new Error(`check-page-events: ${from} globs a directory wildcard (${pattern}); teach globbed() to walk it`);
  if (!existsSync(join(root, dir))) return [];
  const match = new RegExp(`^${leaf.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`).replaceAll('*', '[^/]*')}$`, 'u');
  return readdirSync(join(root, dir)).filter(entry => match.test(entry)).map(entry => `${dir}/${entry}`);
}

/** @param {ts.Expression | undefined} options @returns {boolean} an eager glob that evaluates modules, not a lazy or raw-text one */
function evaluatesModules(options) {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  const props = new Map(options.properties.filter(ts.isPropertyAssignment).map(prop => [prop.name.getText(), prop.initializer]));
  return props.get('eager')?.kind === ts.SyntaxKind.TrueKeyword && !props.has('query') && !props.has('as');
}

/**
 * @param {string} root @param {string} file @param {ts.SourceFile | null} source @param {Record<string, string>} exported
 * @returns {string[]} files this one evaluates in its own realm: static and literal dynamic imports, eager module globs,
 * an HTML page's module scripts. A worker URL is another realm with its own bus, so it is never an edge here.
 */
function runtimeImports(root, file, source, exported) {
  if (file.endsWith('.html')) {
    const html = readFileSync(join(root, file), 'utf8'), out = /** @type {string[]} */ ([]);
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gu)) {
      const src = /\bsrc=["']([^"']+)["']/u.exec(tag)?.[1];
      if (src === undefined || !/\btype=["']module["']/u.test(tag)) continue;
      const path = resolveSpec(root, file, src.startsWith('/') ? src : `./${src}`, exported);
      if (path !== null) out.push(path);
    }
    return out;
  }
  if (source === null) return [];
  const out = /** @type {string[]} */ ([]);
  /** @param {string} spec */
  const add = spec => { const path = resolveSpec(root, file, spec, exported); if (path !== null) out.push(path); };
  /** @param {ts.Node} node */
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword : node.isTypeOnly;
      const spec = literal(node.moduleSpecifier);
      if (!typeOnly && spec !== null) add(spec);
    }
    if (ts.isCallExpression(node)) {
      const [first, second] = node.arguments, spec = first === undefined ? null : literal(first);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && spec !== null) add(spec);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob' && node.expression.expression.getText(source) === 'import.meta'
        && first !== undefined && evaluatesModules(second)) {
        const patterns = (ts.isArrayLiteralExpression(first) ? first.elements.map(literal) : [spec]).filter(pattern => pattern !== null);
        const drop = new Set(patterns.filter(pattern => pattern.startsWith('!')).flatMap(pattern => globbed(root, file, pattern)));
        for (const pattern of patterns.filter(row => !row.startsWith('!'))) out.push(...globbed(root, file, pattern).filter(path => !drop.has(path)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * @typedef {{ files: Set<string>, names: Map<string, number> }} Reach
 * @param {string} root @param {string[]} entries @param {(file: string) => boolean} [stop] a file the walk never enters
 * @returns {Reach} every file the entries evaluate, transitively (type-only imports excluded), and how often each
 * identifier or string literal appears in their non-test code
 */
export function productionReach(root, entries, stop = () => false) {
  const exported = exportMap(root), files = new Set(), names = new Map(), queue = entries.filter(entry => existsSync(join(root, entry)));
  /** @param {ts.Node} node */
  const count = node => {
    const name = ts.isIdentifier(node) || ts.isPrivateIdentifier(node) ? node.text : ts.isStringLiteral(node) ? node.text : null;
    if (name !== null) names.set(name, (names.get(name) ?? 0) + 1);
    ts.forEachChild(node, count);
  };
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (files.has(file)) continue;
    files.add(file);
    const source = SOURCE.test(file) ? parse(root, file) : null;
    if (source !== null && !isTestPath(file)) count(source);
    for (const next of runtimeImports(root, file, source, exported)) if (!files.has(next) && !stop(next)) queue.push(next);
  }
  return { files, names };
}

/** @param {ts.SourceFile} source @returns {string} the file's text with every comment blanked to spaces */
export function codeOnly(source) {
  const text = source.text, chars = text.split(''), seen = new Set();
  /** @param {ts.CommentRange[] | undefined} ranges */
  const blank = ranges => {
    for (const { pos, end } of ranges ?? []) {
      if (seen.has(pos)) continue;
      seen.add(pos);
      for (let at = pos; at < end; at++) if (chars[at] !== '\n') chars[at] = ' ';
    }
  };
  /** @param {ts.Node} node */
  const visit = node => {
    blank(ts.getLeadingCommentRanges(text, node.pos));
    blank(ts.getTrailingCommentRanges(text, node.end));
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return chars.join('');
}

/** @param {ts.Node} fn @returns {ts.Node | null} the name node a function is called by, if it has one */
function calledBy(fn) {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isGetAccessor(fn) || ts.isSetAccessor(fn)) && fn.name !== undefined) return fn.name;
  if (ts.isConstructorDeclaration(fn)) return ts.isClassLike(fn.parent) ? fn.parent.name ?? null : null;
  if (!isFunction(fn)) return null;
  const { parent } = fn;
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.initializer === fn) return parent.name;
  if (ts.isBinaryExpression(parent) && parent.right === fn && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return ts.isPropertyAccessExpression(parent.left) ? parent.left.name : ts.isIdentifier(parent.left) ? parent.left : null;
  }
  return null; // a callback argument or an IIFE runs when its caller does
}

/**
 * @param {ts.SourceFile} source @param {number} at
 * @returns {string[]} the names of every named function enclosing a position, innermost first
 */
function enclosingNames(source, at) {
  /** @type {ts.Node | null} */
  let deepest = null;
  /** @param {ts.Node} node */
  const find = node => { if (node.getStart(source) <= at && at < node.end) { deepest = node; ts.forEachChild(node, find); } };
  find(source);
  const out = [];
  for (let node = /** @type {ts.Node | null} */ (deepest); node !== null && node !== undefined; node = node.parent) {
    const name = ts.isFunctionLike(node) ? calledBy(node) : null;
    if (name !== null && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name))) out.push(name.text);
  }
  return out;
}

/** @param {string} root @param {string} file @returns {string} a script's code, comments blanked */
const scriptCode = (root, file) => codeOnly(ts.createSourceFile(file, readFileSync(join(root, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));

/** @param {string} root @returns {Set<string>} the flows `worker-client-proof.mjs --only=<flow>` dispatches: the `only` and `runs` names in the dispatchers it imports */
export function proofFlows(root) {
  const flows = new Set();
  if (!existsSync(join(root, RUNNER))) return flows;
  const dispatchers = [...scriptCode(root, RUNNER).matchAll(/\bimport\('\.\/(worker-client-[\w-]+\.mjs)'\)/gu)].map(([, name]) => `scripts/${name}`);
  for (const file of dispatchers.filter(path => existsSync(join(root, path)))) {
    for (const [, only, runs] of scriptCode(root, file).matchAll(/\bonly === '([a-z0-9-]+)'|\bruns\('([a-z0-9-]+)'\)/gu)) flows.add(only ?? runs);
  }
  return flows;
}

const object = (/** @type {unknown} */ value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';
const files = (/** @type {unknown} */ value) => Array.isArray(value) && value.length > 0 && value.every(text);

/**
 * @typedef {{ file: string, emits: string }} Producer
 * @typedef {{ id: string, kind: 'event' | 'dynamic' | 'tap', name: string, bus: 'page' | 'host', listeners: string[], producers: Producer[], proof: string, why?: string, debt?: string }} Row
 * @typedef {{ file: string, name: string, why: string }} Ignore
 * @typedef {{ about: string, entries: { page: string[], host: string[] }, rows: Row[], ignore: Ignore[] }} Table
 * @param {unknown} table @returns {string[]} shape failures
 */
export function tableShape(table) {
  if (!object(table)) return ['the table must be an object'];
  const t = /** @type {Record<string, any>} */ (table), failures = [];
  if (Object.keys(t).sort().join(',') !== 'about,entries,ignore,rows') failures.push('the table needs exactly about, entries, rows, ignore');
  if (!text(t.about)) failures.push('the table needs an about line');
  if (!object(t.entries) || Object.keys(t.entries).sort().join(',') !== BUSES.slice().sort().join(',') || !BUSES.every(bus => files(t.entries[bus]))) failures.push(`entries must list the production entry files of each bus (${BUSES.join(', ')})`);
  if (!Array.isArray(t.rows)) return [...failures, 'rows must be a list'];
  const ids = new Set();
  for (const r of t.rows) {
    const id = object(r) && text(r.id) ? String(r.id) : '(no id)';
    if (!object(r) || !text(r.id) || !KINDS.includes(r.kind) || !text(r.name) || !BUSES.includes(r.bus) || !text(r.proof)) { failures.push(`row ${id} needs id, kind (${KINDS.join('|')}), name, bus (${BUSES.join('|')}) and proof`); continue; }
    const extra = Object.keys(r).filter(key => !['id', 'kind', 'name', 'bus', 'listeners', 'producers', 'proof', 'why', 'debt'].includes(key));
    if (extra.length > 0) failures.push(`row ${id} has unknown fields: ${extra.join(', ')}`);
    if (ids.has(id)) failures.push(`row ${id} is listed twice`);
    ids.add(id);
    if (!files(r.listeners)) failures.push(`row ${id} needs its listener files`);
    if (!Array.isArray(r.producers) || r.producers.length === 0 || !r.producers.every((/** @type {any} */ p) => object(p) && text(p.file) && text(p.emits))) failures.push(`row ${id} needs producers, each { file, emits }`);
    for (const key of ['why', 'debt']) if (r[key] !== undefined && !text(r[key])) failures.push(`row ${id} ${key} must be a sentence`);
  }
  if (!Array.isArray(t.ignore) || !t.ignore.every(row => object(row) && text(row.file) && text(row.name) && text(row.why))) failures.push('ignore rows need file, name and why');
  return failures;
}

/**
 * @param {string} root @param {Table} table
 * @returns {{ failures: string[], debt: string[], sites: Site[], rows: number }}
 */
export function judgePageEvents(root, table) {
  const shape = tableShape(table);
  if (shape.length > 0) return { failures: shape, debt: [], sites: [], rows: 0 };
  const sites = scanListeners(root), failures = [], debt = [];
  const key = (/** @type {string} */ kind, /** @type {string} */ name, /** @type {string} */ file) => `${kind}\0${name}\0${file}`;
  const ignored = new Set(table.ignore.map(row => `${row.name}\0${row.file}`));
  const listed = new Set(table.rows.flatMap(row => row.listeners.map(file => key(row.kind, row.name, file))));
  const found = new Set(sites.map(site => key(site.kind, site.name, site.file)));
  for (const site of sites) {
    if (ignored.has(`${site.name}\0${site.file}`)) continue;
    if (!listed.has(key(site.kind, site.name, site.file))) failures.push(`${site.file}:${site.line} listens to ${site.kind} ${site.name} with no row: add it to a row naming a production producer and its proof`);
  }
  for (const row of table.ignore) if (!sites.some(site => site.name === row.name && site.file === row.file)) failures.push(`ignore ${row.file} ${row.name} matches nothing: drop it`);
  for (const bus of BUSES) for (const entry of table.entries[bus]) if (!existsSync(join(root, entry))) failures.push(`${bus} entry ${entry} is gone`);
  const reach = {
    page: productionReach(root, table.entries.page, file => file.startsWith('src/server/')),
    host: productionReach(root, table.entries.host),
  };
  const flows = proofFlows(root), sources = new Map();
  for (const row of table.rows) {
    for (const file of row.listeners) {
      if (!found.has(key(row.kind, row.name, file))) failures.push(`row ${row.id}: ${file} no longer listens to ${row.kind} ${row.name}: drop it from the row`);
      if (row.bus !== 'page' && file.startsWith('src/client/')) failures.push(`row ${row.id}: ${file} is page code, so its row's bus must be page`);
    }
    for (const { file, emits } of row.producers) {
      if (!existsSync(join(root, file))) { failures.push(`row ${row.id}: producer ${file} is gone`); continue; }
      if (!sources.has(file)) { const source = parse(root, file); sources.set(file, { source, code: codeOnly(source) }); }
      const { source, code } = sources.get(file), at = code.indexOf(emits);
      if (at === -1) { failures.push(`row ${row.id}: producer ${file} no longer has \`${emits}\` in its code`); continue; }
      if (isTestPath(file)) { failures.push(`row ${row.id}: producer ${file} is test code, not a production producer`); continue; }
      if (!reach[row.bus].files.has(file)) {
        failures.push(row.bus === 'page' && reach.host.files.has(file) ? `row ${row.id}: producer ${file} runs only on the server, never on the page`
          : `row ${row.id}: producer ${file} is not reachable from the production ${row.bus} entries (only tests, or nothing, load it)`);
        continue;
      }
      // Each named function around the emit must be referenced by name in production code beyond its own declaration.
      const uncalled = enclosingNames(source, at).filter(name => (reach[row.bus].names.get(name) ?? 0) < 2);
      if (uncalled.length > 0) failures.push(`row ${row.id}: producer ${file} emits inside ${uncalled.join(', ')}, which no production ${row.bus} code names`);
    }
    const flow = /^flow:([a-z0-9-]+)$/u.exec(row.proof)?.[1], script = row.proof.split(' ')[0] ?? '';
    if (row.proof === 'local') {
      const away = row.producers.filter(({ file }) => !file.startsWith('src/client/')).map(({ file }) => file);
      if (row.bus !== 'page' || away.length > 0 || row.why === undefined) failures.push(`row ${row.id}: a local proof needs a page row, a why, and every producer in src/client (not ${away.join(', ') || row.bus})`);
    } else if (flow !== undefined) { if (!flows.has(flow)) failures.push(`row ${row.id}: proof flow ${flow} is not one ${RUNNER} dispatches`); }
    else if (!/^scripts\/[\w.-]+\.m?[jt]s$/u.test(script) || !existsSync(join(root, script)) || !statSync(join(root, script)).isFile()) failures.push(`row ${row.id}: proof ${row.proof} is neither flow:<name>, local, nor an existing repo script`);
    if (row.debt !== undefined) debt.push(`${row.id}: ${row.debt}`);
  }
  return { failures, debt, sites, rows: table.rows.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv.find(arg => arg.startsWith('--root='))?.slice(7) ?? fileURLToPath(new URL('..', import.meta.url)));
  if (process.argv.includes('--list')) {
    for (const site of scanListeners(root)) console.log(`${site.file}:${site.line}\t${site.kind}\t${site.name}`);
    process.exit(0);
  }
  const { failures, debt, sites, rows } = judgePageEvents(root, JSON.parse(readFileSync(join(root, TABLE), 'utf8')));
  for (const line of debt) console.warn(`check-page-events: debt ${line}`);
  if (failures.length > 0) {
    console.error(`check-page-events (SR12) failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check-page-events: ${sites.length} listener sites, ${rows} rows, each with a production producer and a proof; debt ${debt.length}`);
}
