#!/usr/bin/env node
// SPLIT-REPAIR SR12 (meta docs/plans/SPLIT-REPAIR-PLAN.md): the standing guard for the split's one mistake. The flip moved
// combat to the server, so page listeners stayed compiled and green while their producer left the page, and unit tests
// kept passing because they emit the event by hand. `check:listeners` is J148's socket allowlist; this is
// `pnpm check:page-events`.
//
// Every subscription in src/client and src/shared needs a row in lint/page-events.json naming a production producer and
// the proof that drives it for real:
//   - a literal `.on('<event>'`, on any receiver (the page bus, ctx, a scope's events, a host bus in shared code);
//   - a dynamic `.on(<expr>` on a bus (`events`, `*.events`, `ctx`, `context`), whose event comes from data;
//   - a callback tap: an assignment to `.onKill`, `.onWindup`, `.onDamage` or `.onSound`, or `tap(x, '<tap>', ...)`.
// A row is { id, kind, name, bus, listeners: [file], producers: [{ file, emits }], proof, why?, debt? }. It is red when:
//   - a listener has no row for its kind, name and file (a new listener);
//   - a row's listener file no longer subscribes there (a stale row: drop the file);
//   - a producer's file is gone, or no longer contains its `emits` text (the producer left);
//   - a producer is reached only by tests: it is not in the import closure of its bus's entries. The page closure starts
//     at the page entries and never crosses into src/server, so a producer that moved to the server's bus is not a page
//     producer. A src/client listener is always on a `page` row;
//   - a proof is neither `flow:<name>` that worker-client-proof runs nor an existing repo file.
// `debt` names an open finding on its row: the check prints the count and stays green. `ignore` rows name a site that is
// not a game-event listener (DOM, Sentry, a day-cycle phase, a ctx.on forwarder) and say why.
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
const KINDS = ['event', 'dynamic', 'tap'];
const SCANNED = ['src/client', 'src/shared'];
const SOURCE = /\.(?:ts|tsx|mts)$/u;
const BUS = /^(?:.*\.)?events$|^ctx$|^context$/u;

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
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'on' && first !== undefined) {
        const name = literal(first), receiver = callee.expression.getText(source).replaceAll(/\s+/gu, '').replace(/\?$/u, '');
        if (name !== null && name !== '') sites.push({ file, line: line(node), kind: 'event', name });
        else if (name === null && BUS.test(receiver)) sites.push({ file, line: line(node), kind: 'dynamic', name: receiver });
      }
      if (ts.isIdentifier(callee) && callee.text === 'tap' && second !== undefined) {
        const name = literal(second);
        if (name !== null && TAPS.includes(name)) sites.push({ file, line: line(node), kind: 'tap', name });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isPropertyAccessExpression(node.left) && TAPS.includes(node.left.name.text)) {
      sites.push({ file, line: line(node), kind: 'tap', name: node.left.name.text });
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
  if (dir.includes('*') || !existsSync(join(root, dir))) return [];
  const match = new RegExp(`^${leaf.replaceAll(/[.+^${}()|[\]\\]/gu, String.raw`\$&`).replaceAll('*', '[^/]*')}$`, 'u');
  return readdirSync(join(root, dir)).filter(entry => match.test(entry)).map(entry => `${dir}/${entry}`);
}

/** @param {string} root @param {string} file @param {Record<string, string>} exported @returns {string[]} files this one loads at runtime */
function runtimeImports(root, file, exported) {
  if (file.endsWith('.html')) {
    const html = readFileSync(join(root, file), 'utf8');
    return [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/gu)]
      .map(([, src = '']) => resolveSpec(root, file, src.startsWith('/') ? src : `./${src}`, exported)).filter(path => path !== null);
  }
  if (!SOURCE.test(file)) return [];
  const source = parse(root, file), out = /** @type {string[]} */ ([]);
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
      const [first] = node.arguments, spec = first === undefined ? null : literal(first);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && spec !== null) add(spec);
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob' && node.expression.expression.getText(source) === 'import.meta' && first !== undefined) {
        const patterns = (ts.isArrayLiteralExpression(first) ? first.elements.map(literal) : [spec]).filter(pattern => pattern !== null);
        const drop = new Set(patterns.filter(pattern => pattern.startsWith('!')).flatMap(pattern => globbed(root, file, pattern)));
        for (const pattern of patterns.filter(row => !row.startsWith('!'))) out.push(...globbed(root, file, pattern).filter(path => !drop.has(path)));
      }
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
      const [first, second] = node.arguments ?? [], spec = first === undefined ? null : literal(first);
      if (spec !== null && second !== undefined && second.getText(source) === 'import.meta.url') add(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * @param {string} root @param {string[]} entries @param {(file: string) => boolean} [stop] a file the walk never enters
 * @returns {Set<string>} every file the entries load at runtime, transitively (type-only imports excluded)
 */
export function productionReach(root, entries, stop = () => false) {
  const exported = exportMap(root), seen = new Set(), queue = entries.filter(entry => existsSync(join(root, entry)));
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of runtimeImports(root, file, exported)) if (!seen.has(next) && !stop(next)) queue.push(next);
  }
  return seen;
}

/** @param {string} root @returns {Set<string>} the flows `worker-client-proof.mjs --play --only=<flow>` runs */
export function proofFlows(root) {
  const flows = new Set(), dir = join(root, 'scripts');
  if (!existsSync(dir)) return flows;
  for (const entry of readdirSync(dir).filter(name => /^worker-client-.*\.mjs$/u.test(name))) {
    const code = readFileSync(join(dir, entry), 'utf8');
    for (const [, only, runs] of code.matchAll(/\bonly === '([a-z0-9-]+)'|\bruns\('([a-z0-9-]+)'\)/gu)) flows.add(only ?? runs);
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
  const flows = proofFlows(root);
  for (const row of table.rows) {
    for (const file of row.listeners) {
      if (!found.has(key(row.kind, row.name, file))) failures.push(`row ${row.id}: ${file} no longer listens to ${row.kind} ${row.name}: drop it from the row`);
      if (row.bus !== 'page' && file.startsWith('src/client/')) failures.push(`row ${row.id}: ${file} is page code, so its row's bus must be page`);
    }
    for (const { file, emits } of row.producers) {
      if (!existsSync(join(root, file))) { failures.push(`row ${row.id}: producer ${file} is gone`); continue; }
      if (!readFileSync(join(root, file), 'utf8').includes(emits)) { failures.push(`row ${row.id}: producer ${file} no longer has \`${emits}\``); continue; }
      if (isTestPath(file)) failures.push(`row ${row.id}: producer ${file} is test code, not a production producer`);
      else if (row.bus === 'page' && !reach.page.has(file) && reach.host.has(file)) failures.push(`row ${row.id}: producer ${file} runs only on the server, never on the page`);
      else if (!reach[row.bus].has(file)) failures.push(`row ${row.id}: producer ${file} is reached only by tests, not from a production ${row.bus} entry`);
    }
    const flow = /^flow:([a-z0-9-]+)$/u.exec(row.proof)?.[1];
    if (row.proof === 'local') {
      // A listener whose every producer is page code shares its process: the split could not move the producer away.
      const away = row.producers.filter(({ file }) => !file.startsWith('src/client/')).map(({ file }) => file);
      if (row.bus !== 'page' || away.length > 0 || row.why === undefined) failures.push(`row ${row.id}: a local proof needs a page row, a why, and every producer in src/client (not ${away.join(', ') || row.bus})`);
    } else if (flow !== undefined) { if (!flows.has(flow)) failures.push(`row ${row.id}: proof flow ${flow} is not one worker-client-proof runs`); }
    else if (!existsSync(join(root, row.proof.split(' ')[0] ?? ''))) failures.push(`row ${row.id}: proof ${row.proof} is neither flow:<name>, local, nor an existing repo script`);
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
