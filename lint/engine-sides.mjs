// P1-E2 (multi-repo plan, J1/J2/J5): the engine ownership map. "Tag first, move later": every non-test source under
// src/engine and src/game names its side in lint/engine-sides.json (shared, server, client or cook) and stays where
// it is until the engine repo cuts it into shared/, server/, client/ and cook/. This module is the one detector the
// oxlint rule (wildshard/engine-sides, per file, in lint:fast) and the census (scripts/check-engine-sides.mjs, whole
// tree) share. Forbidden edges and DOM / renderer use in shared, server and cook are counted per file; today's counts
// sit in lint/engine-side-edges.json and may only fall.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseSync } from 'vite';
import { exportedPath, unsortedPath } from './layer-exports.mjs';
import { DOM as SIM_DOM, MATH as SIM_MATH, reference } from './sim-closure.mjs';

export const SIDES_FILE = resolve(import.meta.dirname, 'engine-sides.json');
export const SIDE_EDGES_FILE = resolve(import.meta.dirname, 'engine-side-edges.json');
export const SIDE_EDGES_LIST = 'lint/engine-side-edges.json';
export const SIDES = ['shared', 'server', 'client', 'cook'];
/** J2 and the plan's §5: which sides each side may not import. */
export const FORBIDDEN = { shared: ['client', 'server'], server: ['client'], client: ['server'], cook: ['client'] };
/** No DOM and no renderer on these sides (§5; extends sim-no-render's detection to the whole side). */
export const HEADLESS = new Set(['shared', 'server', 'cook']);
/** sim-no-render's maths types, plus the remaining pure-maths classes measure-cut admits. */
export const MATH = new Set([...SIM_MATH, 'Triangle', 'Line3', 'Spherical', 'Cylindrical', 'Interpolant', 'LinearInterpolant']);
/** sim-no-render's DOM globals, plus the two measure-cut also counts. */
export const DOM = new Set([...SIM_DOM, 'AudioContext', 'getComputedStyle']);
const RENDER_MODULE = /^(?:three\/|postprocessing(?:\/|$)|n8ao(?:\/|$))/u;
const SOURCE = /\.[cm]?[jt]sx?$/u;

/** A non-test source file the map must tag: the two sorted layers, and src/sdk, which holds the headless host and the
 * standalone target and is tagged in place until they move (MOVES P3). */
export function inScope(path) {
  return /^src\/(?:client|shared|server|cook)\/(?:engine|game|host)\//u.test(path) && SOURCE.test(path) && !path.endsWith('.d.ts')
    && !/\.test\.[cm]?[jt]sx?$/u.test(path) && !path.includes('/test/');
}

/** Repo-relative path of a linted file, also inside a mirror or a fixture root. */
export function sidePath(filename) {
  const path = filename.replaceAll('\\', '/'), at = path.lastIndexOf('/src/');
  return at === -1 ? path : path.slice(at + 1);
}

/** @param {unknown} raw */
export function readSides(raw) {
  if (raw === null || typeof raw !== 'object' || typeof raw.files !== 'object' || raw.files === null) throw new Error('engine-sides: expected { files: { path: side } }');
  /** @type {Map<string, {side: string, mixed: boolean}>} */
  const sides = new Map();
  for (const [path, entry] of Object.entries(raw.files)) {
    const side = typeof entry === 'string' ? entry : entry?.side;
    const mixed = typeof entry === 'object' && entry !== null && entry.mixed === true;
    if (!SIDES.includes(side)) throw new Error(`engine-sides: ${path} has no side (one of ${SIDES.join(', ')})`);
    if (typeof entry === 'object' && (Object.keys(entry).some(key => key !== 'side' && key !== 'mixed') || entry.mixed !== true)) throw new Error(`engine-sides: ${path} is "side" or { "side": …, "mixed": true }`);
    sides.set(path, { side, mixed });
  }
  return sides;
}

/** @param {unknown} raw @returns {Record<string, Record<string, number>>} */
export function readEdges(raw) {
  const files = raw === undefined ? {} : raw?.files;
  if (files === null || typeof files !== 'object') throw new Error('engine-side-edges: expected { files: { path: { edge: count } } }');
  for (const [path, edges] of Object.entries(files)) for (const [edge, count] of Object.entries(edges ?? {})) {
    if (!edgeName(edge) || !Number.isSafeInteger(count) || count <= 0) throw new Error(`engine-side-edges: invalid ${path} ${edge}: ${count}`);
  }
  return files;
}

/** @param {string} edge */
export function edgeName(edge) {
  const [from, to] = edge.split(' → ');
  if (Object.hasOwn(FORBIDDEN, from) && FORBIDDEN[from].includes(to)) return true;
  return HEADLESS.has(from) && ['dom', 'render'].includes(to);
}

const PACKAGE = /^@wildshard\/(engine|format|game|sdk|sharddev|commons)(?:\/([^?#]+))?$/u;
/** Candidate repo paths an import specifier names (the sides map, not the disk, decides which one is ours). */
export function importCandidates(path, specifier) {
  const pkg = PACKAGE.exec(specifier);
  let base;
  if (pkg) base = `src/${pkg[1]}/${pkg[2] ?? 'index'}`;
  else if (specifier.startsWith('.')) base = relative('/', resolve('/', dirname(path), specifier.replace(/[?#].*$/u, ''))).replaceAll('\\', '/');
  else return [];
  const stem = base.replace(/\.[cm]?js$/u, ''), exported = pkg ? exportedPath(pkg[1], pkg[2]) : null;
  return [...exported === null ? [] : [exported], base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.mjs`, `${base}/index.ts`];
}

const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0]?.value.cooked ?? null : null;
const typeOnly = node => {
  if (node.importKind === 'type' || node.exportKind === 'type') return true;
  if (node.type === 'ImportDeclaration') return node.specifiers.length > 0 && node.specifiers.every(s => s.importKind === 'type');
  return node.type === 'ExportNamedDeclaration' && node.specifiers.length > 0 && node.specifiers.every(s => s.exportKind === 'type');
};

/** One walk of a parsed module: its value imports, renderer imports and DOM globals.
 * @returns {{imports: {node: object, source: string}[], render: {node: object, token: string}[], dom: {node: object, token: string}[]}} */
export function sideFacts(program) {
  const imports = [], render = [], dom = [], bound = new Set(), namespaces = new Set(), members = [], globals = [];
  const stack = [[program, null]];
  while (stack.length > 0) {
    const [node, parent] = stack.pop();
    switch (node.type) {
      case 'ImportDeclaration': case 'ExportNamedDeclaration': case 'ExportAllDeclaration': {
        const source = literal(node.source);
        if (node.type === 'ImportDeclaration') for (const s of node.specifiers) bound.add(s.local.name);
        if (source === null || typeOnly(node)) break;
        imports.push({ node, source });
        if (RENDER_MODULE.test(source)) render.push({ node, token: source });
        else if (source === 'three') {
          for (const s of node.specifiers ?? []) {
            if (s.type === 'ImportNamespaceSpecifier') namespaces.add(s.local.name);
            else if (s.importKind !== 'type' && !MATH.has(s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : s.local?.name)) { render.push({ node, token: 'three' }); break; }
          }
          if (node.type !== 'ImportDeclaration' || node.specifiers.length === 0) render.push({ node, token: 'three' });
        }
        break;
      }
      case 'ImportExpression': { const source = literal(node.source); if (source !== null) imports.push({ node, source }); if (source !== null && (RENDER_MODULE.test(source) || source === 'three')) render.push({ node, token: source }); break; }
      case 'VariableDeclarator': if (node.id.type === 'Identifier') bound.add(node.id.name); break;
      case 'FunctionDeclaration': case 'ClassDeclaration': case 'TSTypeAliasDeclaration': case 'TSInterfaceDeclaration':
        if (node.id) bound.add(node.id.name); break;
      case 'MemberExpression':
        if (node.object?.type === 'Identifier') members.push({ node, parent });
        if (['window', 'globalThis'].includes(node.object?.name) && !node.computed && DOM.has(node.property?.name) && node.property.name !== 'window') globals.push({ node, token: node.property.name });
        break;
      case 'Identifier': if (DOM.has(node.name) && reference(node, parent)) globals.push({ node, token: node.name }); break;
      default: break;
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) for (const p of node.params) if (p.type === 'Identifier') bound.add(p.name);
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue;
      if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i--) if (value[i]?.type) stack.push([value[i], node]); }
      else if (value?.type) stack.push([value, node]);
    }
  }
  for (const { node, parent } of members) {
    if (!namespaces.has(node.object.name) || node.computed || parent?.type?.startsWith('TS')) continue;
    if (!MATH.has(node.property.name)) render.push({ node, token: 'three' });
  }
  for (const item of globals) if (item.node.type !== 'Identifier' || !bound.has(item.token)) dom.push(item);
  return { imports, render, dom };
}

/** Every counted violation of one file: forbidden side edges (one per imported file), and on a headless side one per
 * renderer module and one per DOM global. @param {string} path @param {object} program
 * @param {Map<string, {side: string}>} sides */
export function sideViolations(path, program, sides) {
  const own = sides.get(path)?.side;
  if (own === undefined) return [];
  const facts = sideFacts(program), out = [], seen = new Set();
  const add = (edge, unit, node, detail) => { const key = `${edge}|${unit}`; if (!seen.has(key)) { seen.add(key); out.push({ edge, unit, node, detail }); } };
  for (const { node, source } of facts.imports) {
    const target = importCandidates(path, source).find(candidate => sides.has(candidate));
    if (target === undefined) continue;
    const side = sides.get(target)?.side ?? '';
    if (FORBIDDEN[own].includes(side)) add(`${own} → ${side}`, target, node, `imports ${side} ${target}`);
  }
  if (HEADLESS.has(own)) {
    for (const { node, token } of facts.render) add(`${own} → render`, token, node, `uses the renderer (${token})`);
    for (const { node, token } of facts.dom) add(`${own} → dom`, token, node, `uses the DOM (${token})`);
  }
  return out;
}

/** The oxlint rule: an untagged file fails; a file's count on any edge above its recorded count fails.
 * @param {string} sidesFile @param {string} edgesFile */
export function engineSidesRule(sidesFile, edgesFile) {
  let loaded = null;
  const load = () => {
    loaded ??= {
      sides: readSides(JSON.parse(readFileSync(sidesFile, 'utf8'))),
      edges: readEdges(existsSync(edgesFile) ? JSON.parse(readFileSync(edgesFile, 'utf8')) : undefined),
    };
    return loaded;
  };
  return {
    meta: { type: 'problem', docs: { description: 'Engine ownership map: every engine and game file has a side; client, server and shared stay apart (P1-E2)' }, schema: [] },
    create(context) {
      const path = sidePath(context.filename);
      if (!inScope(path)) return {};
      return { Program(program) {
        const { sides, edges } = load();
        if (!sides.has(path)) {
          context.report({ node: program, message: `ENGINE-SIDES: ${path} has no side. Add it to lint/engine-sides.json as "shared", "server", "client" or "cook" (P1-E2)` });
          return;
        }
        const recorded = edges[path] ?? {}, counts = new Map();
        for (const violation of sideViolations(path, program, sides)) {
          const count = (counts.get(violation.edge) ?? 0) + 1, limit = recorded[violation.edge] ?? 0;
          counts.set(violation.edge, count);
          if (count > limit) context.report({ node: violation.node, message: `ENGINE-SIDES ${violation.edge}: ${path} ${violation.detail} (recorded ${limit}, now ${count}; lint/engine-side-edges.json only falls) (P1-E2)` });
        }
      } };
    },
  };
}

/** Every in-scope source under root, sorted. @param {string} root */
export function sideSources(root) {
  const files = [];
  const scan = dir => {
    if (!existsSync(resolve(root, dir))) return;
    for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && path !== 'src/server/host/dist') scan(path); }
      else if (inScope(path)) files.push(path);
    }
  };
  for (const side of ['client', 'shared', 'server', 'cook']) for (const layer of ['engine', 'game', 'host']) scan(`src/${side}/${layer}`);
  return files.sort((a, b) => a.localeCompare(b));
}

/** The whole-tree census: untagged files, stale tags, and every file's counts by edge.
 * @param {string} root @param {Map<string, {side: string}>} sides */
export function sideCensus(root, sides) {
  const files = sideSources(root), present = new Set(files), counts = {}, units = [];
  for (const path of files) {
    if (!sides.has(path)) continue;
    const parsed = parseSync(path, readFileSync(resolve(root, path), 'utf8'));
    if (parsed.errors.length > 0) throw new Error(`engine-sides: cannot parse ${path}`);
    for (const violation of sideViolations(path, parsed.program, sides)) {
      counts[path] ??= {};
      counts[path][violation.edge] = (counts[path][violation.edge] ?? 0) + 1;
      units.push({ from: path, edge: violation.edge, unit: violation.unit });
    }
  }
  return { files, untagged: files.filter(path => !sides.has(path)), stale: [...sides.keys()].filter(path => !present.has(path)), counts, units };
}

/** Edge totals of a { path: { edge: count } } table. @param {Record<string, Record<string, number>>} files */
export function edgeTotals(files) {
  const totals = {};
  for (const edges of Object.values(files)) for (const [edge, count] of Object.entries(edges)) totals[edge] = (totals[edge] ?? 0) + count;
  return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)));
}

/** The commit/push comparison: a recorded count never rises and no file gains a new edge (shrink-only). A file that moved
 * side trades its edges for the other side's (a page fight's server → client for its client → server), so its total is what
 * can't rise.
 * @param {unknown} before @param {unknown} after */
export function compareSideEdges(before, after) {
  if (after === undefined) return before === undefined ? [] : [`${SIDE_EDGES_LIST}: the ratchet was removed; lower its counts instead`];
  const failures = [];
  let next, previous;
  try { next = readEdges(after); previous = before === undefined ? undefined : readEdges(before); } catch (error) { return [`${SIDE_EDGES_LIST}: ${error instanceof Error ? error.message : String(error)}`]; }
  if (previous === undefined) return failures; // P1-E2 seeds the ratchet once
  const rows = table => { // a row follows its file across a side move (J122), and two halves of a split add up
    const out = {};
    for (const [path, edges] of Object.entries(table)) for (const [edge, count] of Object.entries(edges)) {
      const row = out[unsortedPath(path)] ??= {};
      row[edge] = (row[edge] ?? 0) + count;
    }
    return out;
  };
  const past = rows(previous), now = rows(next);
  const sum = (/** @type {Record<string, number>} */ edges = {}) => Object.values(edges).reduce((total, count) => total + count, 0);
  const homes = (/** @type {Record<string, unknown>} */ table) => { const out = new Map(); for (const path of Object.keys(table)) out.set(unsortedPath(path), path); return out; };
  const homeBefore = homes(previous), homeAfter = homes(next);
  for (const [path, edges] of Object.entries(now)) {
    const moved = homeBefore.has(path) && homeBefore.get(path) !== homeAfter.get(path);
    if (moved) {
      if (sum(edges) > sum(past[path])) failures.push(`${SIDE_EDGES_LIST}: ${path} rose ${sum(past[path])} → ${sum(edges)} across its move`);
      continue;
    }
    for (const [edge, count] of Object.entries(edges)) {
      const was = past[path]?.[edge] ?? 0;
      if (count > was) failures.push(`${SIDE_EDGES_LIST}: ${path} ${edge} rose ${was} → ${count}`);
    }
  }
  return failures;
}
