#!/usr/bin/env node
// J122: sort src/engine and src/game into client/, shared/, server/ and cook/ by lint/engine-sides.json, in one
// scripted commit. Layout: src/<layer>/<side>/<old path>. Both packages keep their root, so the layer boundary, every
// `@wildshard/engine/...` specifier and pnpm's workspace stay put; only each export's target gains the side.
//   node scripts/sort-sides.mjs                       dry run: plan and proof from HEAD, in memory, to tmp/sort/plan.json
//   node scripts/sort-sides.mjs --rename-proof        also build the candidate commit in a private object store under
//                                                     tmp/sort and report git's real rename detection for it
//   node scripts/sort-sides.mjs --gate-proof          and run the push gate's committed checks on that candidate
//   node scripts/sort-sides.mjs --apply --agent <id>  refuse a dirty tree, re-plan from HEAD, write, regenerate source
//                                                     tables, commit through scripts/commit.sh
//   node scripts/sort-sides.mjs --undo                back to HEAD after an apply that failed before its commit
//   node scripts/sort-sides.mjs --move <path> [--move <path>…] --to <side>
//                                                     dry run of a retag on a dirty tree: the same plan and proofs
//     … --apply --agent <id> [--message <subject>]    land it with commit.sh --patch, then carry other lanes' working text
// Rerun after any commit: it reads the current map, so a late retag moves one file, and a sorted tree plans no work.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from '@typescript/typescript6';

export const SIDES = ['client', 'shared', 'server', 'cook'];
export const LAYERS = ['engine', 'game'];
export const PLAN_FILE = 'tmp/sort/plan.json';
const SIDES_FILE = 'lint/engine-sides.json';
const EDGES_FILE = 'lint/engine-side-edges.json';
const ALLOW_FILE = 'scripts/check-paths.allow.json';
const LAYER_FILE = /^src\/(engine|game)\/(.+)$/u;
const CODE = /\.(?:[cm]?[jt]s|tsx)$/u;
const TAGGED = /\.[cm]?[jt]sx?$/u;
const TEST = /\.test\.[cm]?[jt]sx?$/u;
const TEXT = /\.(?:[cm]?[jt]sx?|css|html|json|md|sh|py|ya?ml|toml|txt)$|(?:^|\/)\.[^/]*ignore$|(?:^|\/)[^./]+$/u;
/** History and receipts keep the paths they were written with; README.md is Jake's to change, and AGENTS.md is his
 * above its J241 marker (see AGENTS_MARKER). */
export const FROZEN = /^(?:progress|project|art|public|ios|android|sources|calibration|docs\/tasks|docs\/reviews)\/|^(?:README|CLAUDE)\.md$|^pnpm-lock\.yaml$|(?:^|\/)node_modules\//u;
/** J241: AGENTS.md is Jake's above this line and agent-written below it. A sort rewrites only below it, and leaves a
 * file without the line untouched; repo-kit's commit hook refuses an AI commit that changes a line above it. */
export const AGENTS_MARKER = '<!-- agents-below: everything under this line is agent-written (Claude, Codex); agents never edit above it (J241) -->';
/** Each side segment a regular expression may meet once a path is sorted; the group keeps it true before and after. */
const SIDE_GROUP = String.raw`(?:(?:client|cook|server|shared)\/)?`;
const MAX_TEXT = 8 * 1024 * 1024;
export const GATE_PHASES = ['binary-json', 'storage', 'deleted-paths', 'ratchet', 'guards', 'fast-lint', 'census'];
const CENSUS_CHECKS = [['scripts/check-engine-sides.mjs'], ['scripts/check-sim-players.mjs'], ['scripts/check-graph.mjs', '--source-only']];
/** Divided folders named by a string that is not a path a tool opens: reviewed by hand, file:literal → new text. */
const REVIEWED_LITERALS = { 'src/client/engine/explore/ModelExplorer.ts:src/engine/entities/species/': 'src/engine/*/entities/species/' };

const byPath = (a, b) => a.localeCompare(b);
const git = (root, args, options = {}) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, ...options });
/** Every path the working tree holds against HEAD, literal, for commit.sh, the undo or a carry. */
const changedPaths = root => {
  const rows = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).split('\0').filter(Boolean);
  return rows.map(row => ({ state: row.slice(0, 2), path: row.slice(3) }));
};

/** A committed tree in memory. @param {string} root @returns {Tree} */
export function headTree(root) {
  const head = git(root, ['rev-parse', 'HEAD']).trim(), files = new Map();
  for (const row of git(root, ['ls-tree', '-r', '-z', '--full-tree', '-l', 'HEAD']).split('\0')) {
    const match = /^(\d+) blob (\w+) +(\d+)\t(.+)$/su.exec(row);
    if (match !== null) files.set(match[4], { mode: match[1], oid: match[2], size: Number(match[3]) });
  }
  const wanted = [...files].filter(([path, file]) => file.mode !== '120000' && file.size <= MAX_TEXT && TEXT.test(path) && !FROZEN.test(path));
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${wanted.map(([, file]) => file.oid).join('\n')}\n`, maxBuffer: 2 ** 32 });
  const text = new Map();
  let at = 0;
  for (const [path] of wanted) {
    const end = out.indexOf(10, at), header = out.toString('latin1', at, end).split(' '), size = Number(header[2]);
    const body = out.subarray(end + 1, end + 1 + size);
    at = end + 1 + size + 1;
    if (!body.includes(0)) text.set(path, body.toString('utf8'));
  }
  return { head, paths: new Set(files.keys()), text, modes: new Map([...files].map(([path, file]) => [path, file.mode])) };
}

/** Old-tree index: which directories exist and how to resolve a specifier. */
function indexTree(tree) {
  const dirs = new Set(['.']);
  for (const path of tree.paths) for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) dirs.add(path.slice(0, at));
  const exportsOf = new Map();
  for (const layer of LAYERS) {
    const raw = tree.text.get(`src/${layer}/package.json`);
    exportsOf.set(layer, raw === undefined ? {} : JSON.parse(raw).exports ?? {});
  }
  return { dirs, exportsOf };
}

const split = spec => { const at = spec.search(/[?#]/u); return at === -1 ? [spec, ''] : [spec.slice(0, at), spec.slice(at)]; };

/** The file a repo path names, the way the bundler and TypeScript extend it. */
function fileAt(tree, base) {
  if (tree.paths.has(base)) return base;
  const stem = base.replace(/\.[cm]?js$/u, '');
  for (const candidate of [`${stem}.ts`, `${stem}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}.d.ts`, `${base}.js`, `${base}.mjs`, `${base}.json`, `${base}/index.ts`]) if (tree.paths.has(candidate)) return candidate;
  return null;
}

/** @returns {string | null} */
export function resolveSpecifier(tree, index, from, spec) {
  const [path] = split(spec);
  const pkg = /^@wildshard\/(engine|game)\/(.+)$/u.exec(path);
  if (pkg !== null) {
    const target = index.exportsOf.get(pkg[1])?.[`./${pkg[2]}`];
    return typeof target === 'string' ? posix.join(`src/${pkg[1]}`, target) : null;
  }
  if (!path.startsWith('.')) return null;
  const base = posix.join(posix.dirname(from), path);
  return base.startsWith('..') ? null : fileAt(tree, base);
}

const scriptKind = path => /\.[cm]?tsx?$/u.test(path) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
const IMPORT_META_URL = node => ts.isPropertyAccessExpression(node) && node.name.text === 'url' && ts.isMetaProperty(node.expression);

/** Every string literal of a module that could name a path. @returns {Literal[]} */
export function literalsOf(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, scriptKind(path)), out = [];
  const take = (node, bare) => { out.push({ start: node.getStart(file) + 1, end: node.getEnd() - 1, value: node.text, bare }); };
  const visit = node => {
    if (ts.isStringLiteralLike(node)) take(node, false);
    else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2 && ts.isStringLiteralLike(node.arguments[0]) && IMPORT_META_URL(node.arguments[1])) {
      take(node.arguments[0], true); // new URL('sibling.ts', import.meta.url) is relative without a dot
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

/** Module specifiers only, for the import graph. */
function moduleEdges(path, source) {
  const out = [];
  for (const literal of literalsOf(path, source)) if ((literal.bare || /^\.\.?\/./u.test(literal.value) || literal.value.startsWith('@wildshard/')) && !/[*{]/u.test(literal.value)) out.push(literal);
  return out;
}

/** Literal → the repo file it names, or null. */
function edgeTarget(tree, index, from, literal) {
  const value = literal.bare && !literal.value.startsWith('.') ? `./${literal.value}` : literal.value;
  return resolveSpecifier(tree, index, from, value);
}

const sideOf = entry => typeof entry === 'string' ? entry : entry?.side;
const parts = path => { const match = LAYER_FILE.exec(path); return match === null ? null : { layer: match[1], rel: match[2] }; };
const sideSegment = rel => { const first = rel.split('/')[0] ?? ''; return SIDES.includes(first) ? first : null; };
const unsorted = rel => sideSegment(rel) === null ? rel : rel.slice(rel.indexOf('/') + 1);
const inTagScope = path => parts(path) !== null && TAGGED.test(path) && !path.endsWith('.d.ts') && !TEST.test(path) && !path.includes('/test/');
const staysAtRoot = rel => rel === 'package.json' || /^tsconfig[^/]*\.json$/u.test(rel) || rel.startsWith('test/');

/** The commonest side at or above a directory. */
function directorySide(dir, tags) {
  for (let at = dir; at !== '.' && at !== 'src'; at = posix.dirname(at)) {
    const count = {};
    for (const [path, side] of tags) if (path.startsWith(`${at}/`)) count[side] = (count[side] ?? 0) + 1;
    const best = Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best !== undefined) return best[0];
  }
  return 'shared';
}

/** Tests follow what they exercise: client and server never share a folder, so a both-sides test takes the larger. */
function sideByImports(sides, fallback) {
  const count = side => sides.filter(item => item === side).length;
  const headed = ['client', 'server', 'cook'].filter(side => count(side) > 0).sort((a, b) => count(b) - count(a));
  if (headed.length === 0) return sides.length > 0 ? 'shared' : fallback;
  return headed.length > 1 && count(headed[0]) === count(headed[1]) ? (headed.includes(fallback) ? fallback : headed[0]) : headed[0];
}

/** Which side every file of the layers lands on, tagged or derived; refuses what it cannot place.
 * @param {Tree} tree @param {Record<string, unknown>} rawFiles @returns {Placement} */
export function placeFiles(tree, rawFiles) {
  const index = indexTree(tree), tags = new Map(), untagged = [], stale = [], moves = new Map(), derived = {}, crossSideTests = [], kept = [];
  for (const [path, entry] of Object.entries(rawFiles)) {
    if (tree.paths.has(path)) tags.set(path, sideOf(entry)); else stale.push(path);
  }
  const layerFiles = [...tree.paths].filter(path => parts(path) !== null).sort(byPath);
  for (const path of layerFiles) if (inTagScope(path) && !tags.has(path)) untagged.push(path);
  const importers = new Map(), edges = new Map();
  for (const [path, source] of tree.text) {
    if (!CODE.test(path)) continue;
    for (const literal of moduleEdges(path, source)) {
      const target = edgeTarget(tree, index, path, literal);
      if (target === null) continue;
      if (parts(path) !== null) { if (!edges.has(path)) edges.set(path, []); edges.get(path).push(target); }
      if (parts(target) !== null && tags.has(path)) { if (!importers.has(target)) importers.set(target, new Set()); importers.get(target).add(tags.get(path)); }
    }
  }
  const sideFor = path => {
    const { rel } = parts(path) ?? { rel: '' }, tagged = tags.get(path);
    if (tagged !== undefined) return { side: tagged, why: 'tag' };
    const sibling = TEST.test(path) ? ['.ts', '.tsx', '.js', '.mjs'].map(ext => path.replace(TEST, ext)).find(file => tags.has(file)) : undefined;
    if (sibling !== undefined) return { side: tags.get(sibling), why: 'sibling' };
    if (sideSegment(rel) !== null) return { side: sideSegment(rel), why: 'placed' };
    const fallback = directorySide(posix.dirname(path), tags), reach = (edges.get(path) ?? []).flatMap(file => tags.has(file) ? [tags.get(file)] : []);
    if (TEST.test(path)) {
      if (reach.includes('client') && reach.includes('server')) crossSideTests.push(path);
      return { side: sideByImports(reach, fallback), why: reach.length > 0 ? 'imports' : 'directory' };
    }
    if (path.endsWith('.css')) return { side: 'client', why: 'css' };
    if (path.endsWith('.d.ts')) return { side: sideByImports(reach, fallback), why: 'declares' };
    const users = [...importers.get(path) ?? []];
    if (users.length === 1) return { side: users[0], why: 'importers' };
    return users.length > 1 ? { side: 'shared', why: 'importers' } : { side: fallback, why: 'directory' };
  };
  for (const path of layerFiles) {
    const { layer, rel } = parts(path) ?? { layer: '', rel: '' };
    if (staysAtRoot(rel) || (TEST.test(path) && !rel.includes('/') && !edges.get(path)?.some(file => tags.has(file)))) { kept.push(path); continue; }
    const { side, why } = sideFor(path), target = `src/${layer}/${side}/${unsorted(rel)}`;
    derived[why] = (derived[why] ?? 0) + 1;
    if (target !== path) moves.set(path, target);
  }
  return { index, tags, moves, untagged, stale, derived, crossSideTests, kept };
}

/** Where every directory of the layers lands, when all of it lands together. */
function directoryMoves(tree, moves) {
  const seen = new Map();
  for (const path of tree.paths) {
    const at = parts(path);
    if (at === null) continue;
    const target = moves.get(path) ?? path, moved = target.split('/').slice(0, 3).join('/'), segments = path.split('/');
    for (let end = 3; end < segments.length; end++) {
      const dir = segments.slice(0, end).join('/');
      if (!seen.has(dir)) seen.set(dir, new Set());
      seen.get(dir).add(target === path ? `kept:${dir}` : moved);
    }
  }
  const unanimous = new Map(), divided = new Set();
  for (const [dir, roots] of seen) {
    const [only] = roots;
    if (roots.size === 1 && only !== undefined && !only.startsWith('kept:')) unanimous.set(dir, `${only}/${unsorted(dir.split('/').slice(2).join('/'))}`);
    else if (roots.size > 1) divided.add(dir);
  }
  return { unanimous, divided };
}

const rebased = (fromDir, target) => {
  const rel = posix.relative(fromDir, target);
  if (rel === '') return `../${posix.basename(target)}`; // `../sim` from inside sim/: the file beside its own folder
  return rel.startsWith('.') ? rel : `./${rel}`;
};

/** The new spelling of one relative literal, or a note why it has none. */
function rewriteRelative(tree, index, moves, dirMoves, from, literal) {
  const value = literal.bare && !literal.value.startsWith('.') ? `./${literal.value}` : literal.value;
  if (!/^\.\.?\/./u.test(value)) return null;
  const [path, suffix] = split(value), newDir = posix.dirname(moves.get(from) ?? from), oldDir = posix.dirname(from);
  const slash = path.endsWith('/') ? '/' : '', base = posix.join(oldDir, path).replace(/\/$/u, '');
  if (base.startsWith('..')) return null;
  const bare = spec => literal.bare && !literal.value.startsWith('.') && spec.startsWith('./') ? spec.slice(2) : spec;
  const target = fileAt(tree, base);
  if (target !== null) {
    if (!moves.has(from) && !moves.has(target)) return null;
    const next = moves.get(target) ?? target;
    let tail = target.startsWith(base) ? target.slice(base.length) : '', stem = next.slice(0, next.length - tail.length);
    if (!target.startsWith(base)) { const ext = posix.extname(base); stem = next.replace(/\.[^./]+$/u, ext); tail = ''; }
    const spec = bare(rebased(newDir, stem)) + suffix;
    return spec === literal.value ? null : { spec };
  }
  if (index.dirs.has(base)) {
    if (dirMoves.divided.has(base)) return moves.has(from) ? { note: 'divided-literal', value: literal.value } : null;
    if (!moves.has(from) && !dirMoves.unanimous.has(base)) return null;
    const spec = bare(rebased(newDir, dirMoves.unanimous.get(base) ?? base)) + slash + suffix;
    return spec === literal.value ? null : { spec };
  }
  if (!moves.has(from)) return null;
  const layerRoot = from.split('/').slice(0, 2).join('/');
  if (/[*{]/u.test(path)) return null; // import.meta.glob has its own pass; any other is not a path
  if (base.startsWith(`${layerRoot}/`)) return /^\.\.?\/[\w.@-]/u.test(value) ? { note: 'missing-relative', value: literal.value } : null;
  const spec = bare(rebased(newDir, base)) + slash + suffix;
  return spec === literal.value ? null : { spec, note: 'rebased-missing', value: literal.value };
}

const PATH_TOKEN = /(?<![\w@-])src\/(engine|game)\/([\w.\-/@]*)/gu;
const SHORT_TOKEN = /(?<![\w@/.-])(engine|game)\/([\w.\-/]+)/gu;
const ESCAPED_TOKEN = /src\\\/(engine|game)\\\/(?!\(\?:\(\?:client)/gu;
/** A path relative to somewhere else: an import a generator emits into its output, a shard's map input. */
const FOREIGN_RELATIVE = /(?<![\w./-])((?:\.\.?\/)+)(engine|game)\/([\w.\-/]+)/gu;
const FOREIGN_FILE = /^scripts\/.*\.[cm]?[jt]s$|^src\/shards\/[^/]+\/(?:data|look)\/map\.json$/u;

/** Rewrite repo-rooted spellings: `src/engine/x`, with the bare-file forms a tool may hand a `src(...)` helper. */
export function rewriteTokens(text, path, tree, moves, dirMoves, notes) {
  const shape = (layer, rawRest, whole, next) => {
    const rest = rawRest.replace(/[./]+$/u, ''), tail = rawRest.slice(rest.length);
    if (rest === '') return whole;
    const old = `src/${layer}/${rest}`, file = fileAt(tree, old);
    if (file !== null && (file === old || !tree.paths.has(old))) {
      const target = moves.get(file);
      if (target === undefined) return whole;
      const ext = file.slice(old.length);
      return `${(file === old ? target : target.slice(0, target.length - ext.length))}${tail}`;
    }
    const whole2 = dirMoves.unanimous.get(old);
    if (whole2 !== undefined) return `${whole2}${tail}`;
    if (dirMoves.divided.has(old)) {
      if (next.startsWith('*')) return `src/${layer}/*/${unsorted(rest)}${tail}`;
      notes.push({ kind: CODE.test(path) ? 'divided-comment' : 'divided-prose', file: path, value: old });
    }
    return whole;
  };
  let out = text.replaceAll(PATH_TOKEN, (whole, layer, rest, at, source) => shape(layer, rest, whole, source.slice(at + whole.length)));
  if (/^(?:scripts|lint)\/|\.md$/u.test(path)) {
    out = out.replaceAll(SHORT_TOKEN, (whole, layer, raw) => {
      const rest = raw.replace(/[./]+$/u, ''), tail = raw.slice(rest.length), old = `src/${layer}/${rest}`, file = fileAt(tree, old);
      if (file === null || !moves.has(file) || (path.endsWith('.md') && file !== old)) return whole;
      const target = moves.get(file) ?? '', ext = file.slice(old.length);
      return `${target.slice(4, target.length - ext.length)}${tail}`;
    });
  }
  if (FOREIGN_FILE.test(path)) {
    out = out.replaceAll(FOREIGN_RELATIVE, (whole, dots, layer, rest, at, source) => {
      const moved = shape(layer, rest, `src/${layer}/${rest}`, source.slice(at + whole.length));
      return moved === `src/${layer}/${rest}` ? whole : `${dots}${moved.slice(4)}`;
    });
  }
  if (CODE.test(path)) out = out.replaceAll(ESCAPED_TOKEN, match => `${match}${SIDE_GROUP}`);
  return out;
}

const ROOTED_TOKEN = /(?<![\w/.@-])(\.\/)?((?:client|cook|server|shared)\/[\w./-]+?)(?=["'\\])/gu;

/** An isolated declaration test spells its layer's modules from the layer root: `server/grid/rules`. */
function rewriteRooted(text, path, tree, moves) {
  const layer = /^src\/(engine|game)\/isolated-[^/]+\.test\.ts$/u.exec(path)?.[1];
  if (layer === undefined) return text;
  const root = `src/${layer}/`;
  return text.replaceAll(ROOTED_TOKEN, (whole, dot, rel) => {
    const old = `${root}${rel}`, file = fileAt(tree, old), next = file === null ? undefined : moves.get(file);
    return file === null || next === undefined ? whole : `${dot ?? ''}${next.slice(root.length, next.length - (file.length - old.length))}`;
  });
}

/** Keep a list sorted when its keys change, only where re-serialising it is byte-identical to what it was. */
function resortJson(path, before, after) {
  if (!path.endsWith('.json')) return after;
  let old, next;
  try { old = JSON.parse(before); next = JSON.parse(after); } catch { return after; }
  const indent = /^\{\n( +)/u.exec(before)?.[1]?.length ?? 2;
  if (`${JSON.stringify(old, null, indent)}\n` !== before) return after;
  const walk = (a, b) => {
    if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
    const keys = Object.keys(b), sorted = a !== null && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).every((key, i, all) => i === 0 || all[i - 1].localeCompare(key) <= 0);
    const order = sorted ? [...keys].sort((x, y) => x.localeCompare(y)) : keys;
    return Object.fromEntries(order.map(key => [key, walk(typeof a === 'object' && a !== null ? a[key] ?? a[Object.keys(a)[keys.indexOf(key)]] : undefined, b[key])]));
  };
  return `${JSON.stringify(walk(old, next), null, indent)}\n`;
}

/** Exports keep their keys; targets gain the side. */
function rewriteExports(text, layer, moves) {
  return text.replaceAll(/^(\s*"\.[^"]*": ")\.\/([^"]+)(",?)$/gmu, (whole, head, target, tail) => {
    const next = moves.get(`src/${layer}/${target}`);
    return next === undefined ? whole : `${head}./${next.slice(`src/${layer}/`.length)}${tail}`;
  });
}

/** check-paths allowances quote a relative literal of their file: the literal moves with it. */
function rewriteAllowances(text, moves) {
  const rows = JSON.parse(text), indent = /^\[\n( +)/u.exec(text)?.[1]?.length ?? 2;
  for (const row of rows) {
    const old = moves.has(row.file) ? row.file : [...moves].find(([, to]) => to === row.file)?.[0];
    if (old === undefined || typeof row.path !== 'string' || !row.path.startsWith('.')) continue;
    const base = posix.join(posix.dirname(old), row.path);
    if (!/^src\/(?:engine|game)\//u.test(base)) row.path = rebased(posix.dirname(moves.get(old) ?? old), base);
  }
  return `${JSON.stringify(rows, null, indent)}\n`;
}

/** engine-sides.json rows follow their files; a stale tag goes, as --update drops it. */
function dropStale(text, stale) {
  if (stale.length === 0) return text;
  const raw = JSON.parse(text);
  for (const path of stale) delete raw.files[path];
  return `${JSON.stringify(raw, null, 1)}\n`;
}

const applyEdits = (source, edits) => {
  let out = source;
  for (const edit of [...new Map(edits.map(item => [item.start, item])).values()].sort((a, b) => b.start - a.start)) out = `${out.slice(0, edit.start)}${edit.text}${out.slice(edit.end)}`;
  return out;
};

const gitignoreBang = pattern => pattern.startsWith('!');
const globMatches = (tree, from, pattern) => {
  const full = posix.join(posix.dirname(from), pattern.replace(/^!/u, ''));
  return [...tree.paths].filter(path => posix.matchesGlob(path, full));
};

/** The `import.meta.glob` calls of a module, with their pattern literals. */
export function globCalls(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, scriptKind(path)), calls = [];
  const take = (node, listed) => ({ start: node.getStart(file) + 1, end: node.getEnd() - 1, value: node.text, quote: source[node.getStart(file)] ?? "'", listed });
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'glob' && ts.isMetaProperty(node.expression.expression)) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteralLike(first)) calls.push([take(first, false)]);
      else if (first !== undefined && ts.isArrayLiteralExpression(first)) calls.push(first.elements.filter(ts.isStringLiteralLike).map(item => take(item, true)));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

/** What a glob call really picks: the positive matches less the negated ones. */
export function globPick(tree, from, patterns) {
  const out = new Set();
  for (const { value } of patterns) if (!gitignoreBang(value)) for (const path of globMatches(tree, from, value)) out.add(path);
  for (const { value } of patterns) if (gitignoreBang(value)) for (const path of globMatches(tree, from, value)) out.delete(path);
  return [...out].sort(byPath);
}

/** One glob call's new patterns: each follows what the call picks; a pick that divides over sides stays a refusal. */
function rewriteGlobs(tree, moves, from, calls, notes) {
  const edits = [], newDir = posix.dirname(moves.get(from) ?? from);
  for (const patterns of calls) {
    const picked = new Set(globPick(tree, from, patterns));
    for (const pattern of patterns) {
      const bang = gitignoreBang(pattern.value) ? '!' : '', body = pattern.value.slice(bang.length), slash = body.search(/[*{]/u);
      const fileName = body.slice(body.lastIndexOf('/', slash === -1 ? body.length : slash) + 1), oldBase = posix.join(posix.dirname(from), body.slice(0, body.length - fileName.length));
      const matched = globMatches(tree, from, pattern.value).filter(path => picked.has(path));
      if (!moves.has(from) && !matched.some(path => moves.has(path)) && slash !== -1) continue;
      const homes = new Set(matched.map(path => { const to = moves.get(path) ?? path; return to.slice(0, to.length - (path.length - oldBase.length) - 1); }));
      const own = slash === -1 ? fileAt(tree, posix.join(posix.dirname(from), body)) : null;
      let places = [...homes];
      if (own !== null) places = [posix.dirname(moves.get(own) ?? own)];
      else if (homes.size === 0 && !/^src\/(?:engine|game)\//u.test(`${oldBase}/`)) places = [oldBase.replace(/\/$/u, '')];
      else if (homes.size === 0) continue;
      const quote = pattern.quote, specs = places.map(home => `${bang}${rebased(newDir, home)}/${fileName}`);
      if (specs.length > 1 && !pattern.listed) notes.push({ kind: 'divided-glob', file: from, value: pattern.value });
      else if (specs.join(',') !== pattern.value) edits.push({ start: pattern.start, end: pattern.end, text: specs.join(`${quote}, ${quote}`) });
    }
  }
  return edits;
}

/** A quoted divided directory in code. An array lists every side that holds it; `x.startsWith(dir)` tests all of them;
 * otherwise the side this file already names for that folder wins; nothing else can be decided mechanically. */
function rewriteDivided(path, source, spelled, moves, dirMoves, notes) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path)), edits = [];
  const sidesOf = dir => SIDES.filter(side => [...moves].some(([from, to]) => from.startsWith(`${dir}/`) && to.startsWith(`src/${dir.split('/')[1]}/${side}/`)));
  const visit = node => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) {
      const match = /^(?:\.\/)?src\/(engine|game)\/([\w\-/.]*?)(\/?)$/u.exec(node.text);
      const dir = match === null ? '' : `src/${match[1]}/${match[2]}`;
      // A folder spelled with its side stays true when one file leaves it; only an unsorted spelling is ambiguous.
      if (match !== null && dirMoves.divided.has(dir) && sideSegment(match[2] ?? '') === null) {
        const start = node.getStart(file), end = node.getEnd(), quote = source[start] ?? "'", slash = match[3], rest = match[2] ?? '', sides = sidesOf(dir), parent = node.parent;
        const inSide = side => `src/${match[1]}/${side}/${unsorted(rest)}${slash}`, named = sides.filter(side => spelled.includes(`src/${match[1]}/${side}/${unsorted(rest)}/`));
        if (ts.isArrayLiteralExpression(parent)) edits.push({ start, end, text: sides.map(side => `${quote}${inSide(side)}${quote}`).join(', ') });
        else if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'startsWith') {
          const target = parent.expression.expression.getText(file);
          edits.push({ start: parent.getStart(file), end: parent.getEnd(), text: `/^src\\/${match[1]}\\/${SIDE_GROUP}${unsorted(rest).replaceAll('/', String.raw`\/`)}${slash === '' ? '' : String.raw`\/`}/u.test(${target})` });
        } else if (named.length === 1 && named[0] !== undefined) edits.push({ start: start + 1, end: end - 1, text: inSide(named[0]) });
        else if (REVIEWED_LITERALS[`${path}:${node.text}`] !== undefined) edits.push({ start: start + 1, end: end - 1, text: REVIEWED_LITERALS[`${path}:${node.text}`] ?? '' });
        else notes.push({ kind: 'divided-literal', file: path, value: dir });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return edits;
}

/** Literal-level relative rewrite of one module or stylesheet. */
function rewriteSource(tree, index, moves, dirMoves, path, source, notes) {
  const edits = [];
  if (CODE.test(path)) {
    for (const literal of literalsOf(path, source)) {
      const result = rewriteRelative(tree, index, moves, dirMoves, path, literal);
      if (result === null) continue;
      if (result.note !== undefined) notes.push({ kind: result.note, file: path, value: result.value });
      if (result.spec !== undefined) edits.push({ start: literal.start, end: literal.end, text: result.spec });
    }
    edits.push(...rewriteGlobs(tree, moves, path, globCalls(path, source), notes));
  } else if (path.endsWith('.css')) {
    for (const match of source.matchAll(/(?:@import\s+|url\(\s*)(['"]?)(\.\.?\/[^'")\s]+)\1/gu)) {
      const start = (match.index ?? 0) + match[0].lastIndexOf(match[2]);
      const result = rewriteRelative(tree, index, moves, dirMoves, path, { value: match[2], bare: false });
      if (result?.spec !== undefined) edits.push({ start, end: start + match[2].length, text: result.spec });
    }
  }
  return applyEdits(source, edits);
}

/** One file's text after a plan's moves: HEAD's bytes, or a lane's working bytes of the same file. AGENTS.md is
 * rewritten only below its J241 marker line. */
function rewriteText(tree, placement, dirMoves, path, before, notes) {
  const cut = frozenPrefix(path, before);
  if (cut === 0) return rewriteWhole(tree, placement, dirMoves, path, before, notes);
  return before.slice(0, cut) + rewriteWhole(tree, placement, dirMoves, path, before.slice(cut), notes);
}

/** How many leading characters of a file a sort keeps: an AGENTS.md (at any depth) through the first line that is
 * exactly its J241 marker (LF, CRLF or end of file), and all of it without one. */
function frozenPrefix(path, text) {
  if (!/(?:^|\/)AGENTS\.md$/u.test(path)) return 0;
  for (let at = 0; at < text.length;) {
    const end = text.indexOf('\n', at), stop = end === -1 ? text.length : end;
    if (text.slice(at, stop).replace(/\r$/u, '') === AGENTS_MARKER) return end === -1 ? text.length : end + 1;
    if (end === -1) break;
    at = end + 1;
  }
  return text.length;
}

function rewriteWhole(tree, placement, dirMoves, path, before, notes) {
  const { moves, index, stale } = placement;
  let after = rewriteSource(tree, index, moves, dirMoves, path, before, notes);
  if (CODE.test(path) && after.includes('src/')) after = applyEdits(after, rewriteDivided(path, after, rewriteTokens(after, path, tree, moves, dirMoves, []), moves, dirMoves, notes));
  after = rewriteRooted(rewriteTokens(after, path, tree, moves, dirMoves, notes), path, tree, moves);
  if (path === SIDES_FILE) after = dropStale(after, stale);
  if (path === ALLOW_FILE) after = rewriteAllowances(after, moves);
  const layer = /^src\/(engine|game)\/package\.json$/u.exec(path)?.[1];
  if (layer !== undefined) after = rewriteExports(after, layer, moves);
  return after === before ? after : resortJson(path, before, after);
}

/** The whole transformation of a tree: pure, no disk. @param {Tree} tree @returns {Plan} */
export function planSort(tree) {
  const raw = tree.text.get(SIDES_FILE);
  if (raw === undefined) throw new Error(`sort-sides: ${SIDES_FILE} is missing`);
  const placement = placeFiles(tree, JSON.parse(raw).files), dirMoves = directoryMoves(tree, placement.moves);
  const notes = [], writes = new Map();
  for (const [path, before] of tree.text) {
    const after = rewriteText(tree, placement, dirMoves, path, before, notes);
    if (after !== before) writes.set(path, after);
  }
  return { head: tree.head, ...placement, dirMoves, notes, writes };
}

/** The sides file with these files on `side`; a `mixed` mark stays. */
function retagText(text, paths, side) {
  const raw = JSON.parse(text);
  for (const path of paths) {
    const entry = raw.files[path];
    if (entry !== undefined) raw.files[path] = typeof entry === 'string' ? side : { ...entry, side };
  }
  return `${JSON.stringify(raw, null, 1)}\n`;
}

/** LEAVES: a retag on a tree that is never clean. Change the tags in memory and let planSort find everything that
 * follows. @param {Tree} tree @param {string[]} paths @param {string} side @returns {{tree: Tree, plan: Plan}} */
export function planMove(tree, paths, side) {
  const raw = tree.text.get(SIDES_FILE);
  if (raw === undefined) throw new Error(`sort-sides: ${SIDES_FILE} is missing`);
  if (!SIDES.includes(side)) throw new Error(`sort-sides: ${side} is not one of ${SIDES.join(', ')}`);
  const tags = JSON.parse(raw).files;
  for (const path of paths) {
    if (tags[path] === undefined) throw new Error(`sort-sides: ${path} has no tag in ${SIDES_FILE}`);
    if (sideOf(tags[path]) === side) throw new Error(`sort-sides: ${path} is already ${side}`);
  }
  const text = retagText(raw, paths, side), moved = { ...tree, text: new Map(tree.text).set(SIDES_FILE, text) }, plan = planSort(moved);
  if (!plan.writes.has(SIDES_FILE)) plan.writes.set(SIDES_FILE, text);
  return { tree: moved, plan };
}

/** Three-way, line by line: what a committed table changed, kept on top of a lane's working rows. */
function mergeRows(root, scratch, name, ours, base, theirs) {
  const file = label => resolve(scratch, `${name}.${label}`);
  writeFileSync(file('ours'), ours); writeFileSync(file('base'), base); writeFileSync(file('theirs'), theirs);
  const result = spawnSync('git', ['merge-file', '-p', file('ours'), file('base'), file('theirs')], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

/** What a landed move leaves in the working tree: another lane's dirty or new text still spells the old layout. It takes
 * the same rewrite, and a dirty moved file goes to its new path with its edits. @returns {{carried: string[], refused: string[]}} */
export function carryWorkingText(root, tree, plan, paths, side, { committed = new Map(), scratch = root } = {}) {
  const carried = [], refused = [];
  for (const { state, path } of changedPaths(root)) {
    if (state.includes('D') || !TEXT.test(path) || FROZEN.test(path)) continue;
    const at = resolve(root, path);
    if (statSync(at).size > MAX_TEXT) continue;
    const before = readFileSync(at, 'utf8'), to = plan.moves.get(path) ?? path;
    if (before.includes('\0')) continue;
    let after = rewriteText(tree, plan, plan.dirMoves, path, path === SIDES_FILE ? retagText(before, paths, side) : before, []);
    const landed = committed.get(path);
    if (landed !== undefined) {
      const merged = mergeRows(root, scratch, posix.basename(path), after, tree.text.get(path) ?? '', landed);
      if (merged === null) { refused.push(path); continue; }
      after = merged;
    }
    if (to === path && after === before) continue;
    mkdirSync(dirname(resolve(root, to)), { recursive: true });
    writeFileSync(resolve(root, to), after);
    if (to !== path) rmSync(at);
    carried.push(to);
  }
  return { carried, refused };
}

/** The tree after the plan, for proofs. */
export function appliedTree(tree, plan) {
  const paths = new Set([...tree.paths].map(path => plan.moves.get(path) ?? path)), text = new Map();
  for (const [path, source] of tree.text) text.set(plan.moves.get(path) ?? path, plan.writes.get(path) ?? source);
  return { head: 'candidate', paths, text, modes: tree.modes };
}

/** Every refusal the plan earns, from the plan alone. @returns {string[]} */
export function planFailures(tree, plan, root = process.cwd()) {
  const failures = [], after = appliedTree(tree, plan), afterIndex = indexTree(after);
  for (const path of plan.untagged) failures.push(`untagged: ${path} has no side in ${SIDES_FILE}`);
  const targets = new Map();
  for (const [from, to] of plan.moves) {
    if (targets.has(to)) failures.push(`collision: ${from} and ${targets.get(to)} both land on ${to}`);
    targets.set(to, from);
    if (tree.paths.has(to) && !plan.moves.has(to)) failures.push(`collision: ${from} lands on tracked ${to}`);
    if (!SIDES.includes(to.split('/')[2] ?? '')) failures.push(`target: ${to} is not under a side folder`);
  }
  for (const [path, side] of plan.tags) {
    const at = plan.moves.get(path) ?? path;
    if (at.split('/')[2] !== side) failures.push(`side: ${path} is tagged ${side} but lands on ${at}`);
  }
  for (const layer of LAYERS) {
    for (const [key, value] of Object.entries(afterIndex.exportsOf.get(layer) ?? {})) {
      if (typeof value === 'string' && !after.paths.has(posix.join(`src/${layer}`, value))) failures.push(`export: @wildshard/${layer}${key.slice(1)} → ${value} is no file`);
    }
    if (JSON.stringify(Object.keys(afterIndex.exportsOf.get(layer) ?? {})) !== JSON.stringify(Object.keys(plan.index.exportsOf.get(layer) ?? {}))) failures.push(`export: @wildshard/${layer} keys changed`);
  }
  const sidesRaw = after.text.get(SIDES_FILE);
  if (sidesRaw !== undefined) for (const path of Object.keys(JSON.parse(sidesRaw).files)) if (!after.paths.has(path)) failures.push(`sides: ${path} names no file`);
  failures.push(...edgeFailures(tree, plan, after, afterIndex), ...compilerFailures(root, after, afterIndex));
  for (const row of JSON.parse(after.text.get(ALLOW_FILE) ?? '[]')) if (after.paths.has(row.file) && after.text.has(row.file) && !(after.text.get(row.file) ?? '').includes(row.path)) failures.push(`allowance: ${row.file} no longer holds ${row.path}`);
  const again = planSort(after);
  if (again.moves.size + again.writes.size > 0) failures.push(`idempotent: a second run would move ${again.moves.size} and rewrite ${again.writes.size}: ${[...again.moves.keys(), ...again.writes.keys()].slice(0, 5).join(', ')}`);
  for (const note of plan.notes) if (note.kind === 'divided-literal' || note.kind === 'divided-glob') failures.push(`${note.kind}: ${note.file} names ${note.value}, which is on several sides`);
  for (const path of [...after.text.keys()].filter(file => !plan.moves.has(file))) {
    const whole = after.text.get(path) ?? '', text = whole.slice(frozenPrefix(path, whole));
    for (const match of text.matchAll(PATH_TOKEN)) {
      const rest = (match[2] ?? '').replace(/[./]+$/u, ''), old = `src/${match[1]}/${rest}`;
      if (plan.moves.has(old) && !plan.dirMoves.divided.has(old)) failures.push(`stale: ${path} still names ${old}`);
    }
  }
  return failures;
}

/** TypeScript's own resolver, over the candidate in memory: `exports`, extensions and `node_modules` links as tsc reads them.
 * Our resolver said where each specifier goes; this says the compiler agrees. @returns {string[]} */
export function compilerFailures(root, after, afterIndex) {
  const base = `${resolve(root)}/`, failures = [];
  const inRepo = file => {
    const path = file.startsWith(base) ? file.slice(base.length) : null;
    return path === null ? null : path.replace(/^node_modules\/@wildshard\/(engine|game)(?=\/|$)/u, 'src/$1');
  };
  const virtual = path => path !== null && !/^node_modules(?:\/|$)/u.test(path);
  const host = {
    fileExists: file => { const path = inRepo(file); return virtual(path) ? after.paths.has(path) : ts.sys.fileExists(file); },
    readFile: file => { const path = inRepo(file); return virtual(path) ? after.text.get(path) : ts.sys.readFile(file); },
    directoryExists: dir => { const path = inRepo(dir); return path === 'node_modules' || path === 'node_modules/@wildshard' || (virtual(path) ? afterIndex.dirs.has(path) : ts.sys.directoryExists?.(dir) ?? false); },
    realpath: file => { const path = inRepo(file); return virtual(path) ? `${base}${path}` : ts.sys.realpath?.(file) ?? file; },
  };
  const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, allowArbitraryExtensions: true, resolveJsonModule: true, noEmit: true };
  const cache = ts.createModuleResolutionCache(base, name => name, options);
  for (const [path, source] of after.text) {
    if (!CODE.test(path)) continue;
    for (const literal of moduleEdges(path, source)) {
      const want = edgeTarget(after, afterIndex, path, literal);
      if (literal.bare || want === null || !/\.tsx?$/u.test(want) || /[?#]/u.test(literal.value)) continue;
      const got = ts.resolveModuleName(literal.value, `${base}${path}`, options, host, cache).resolvedModule?.resolvedFileName;
      if (got === undefined || inRepo(got) !== want) failures.push(`compiler: ${path} '${literal.value}' resolves to ${got ?? 'nothing'}, want ${want}`);
    }
  }
  return failures;
}

/** Every literal of every module still names the image of what it named. */
function edgeFailures(tree, plan, after, afterIndex) {
  const failures = [];
  const inverse = new Map([...plan.moves].map(([from, to]) => [to, from]));
  for (const [path, source] of after.text) {
    if (!CODE.test(path)) continue;
    const old = inverse.get(path) ?? path, oldSource = tree.text.get(old);
    if (oldSource === undefined) { failures.push(`edge: ${path} lost its source`); continue; }
    const before = moduleEdges(old, oldSource), now = moduleEdges(path, source);
    if (before.length !== now.length) { failures.push(`edge: ${path} has ${now.length} specifiers, was ${before.length}`); continue; }
    const beforeGlobs = globCalls(old, oldSource), nowGlobs = globCalls(path, source);
    beforeGlobs.forEach((patterns, i) => {
      const want = globPick(tree, old, patterns).map(file => plan.moves.get(file) ?? file).sort(byPath).join(','), got = globPick(after, path, nowGlobs[i] ?? []).join(',');
      if (want !== got) failures.push(`glob: ${path} call ${i} picks [${got}], want [${want}]`);
    });
    before.forEach((literal, i) => {
      const was = edgeTarget(tree, plan.index, old, literal), is = edgeTarget(after, afterIndex, path, now[i]);
      if (was === null) return;
      const want = plan.moves.get(was) ?? was;
      if (is !== want) failures.push(`edge: ${path} '${now[i].value}' resolves to ${is ?? 'nothing'}, want ${want}`);
    });
  }
  return failures;
}

const cleanTree = root => git(root, ['status', '--porcelain']).trim() === '';

/** The candidate as a commit in a private object store under scratch: no ref, no working file, no write to .git.
 * @returns {{env: NodeJS.ProcessEnv, commit: string}} */
export function candidateCommit(root, tree, plan, scratch) {
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(`${scratch}/objects/pack`, { recursive: true });
  const objects = resolve(root, git(root, ['rev-parse', '--git-path', 'objects']).trim()), marks = resolve(`${scratch}/marks`);
  const env = { ...process.env, GIT_OBJECT_DIRECTORY: resolve(`${scratch}/objects`), GIT_ALTERNATE_OBJECT_DIRECTORIES: objects, GIT_INDEX_FILE: resolve(`${scratch}/index`) };
  const run = (args, input) => execFileSync('git', args, { cwd: root, env, input, encoding: 'utf8', maxBuffer: 1 << 30 });
  const blobs = [...plan.writes.keys()], stream = [];
  blobs.forEach((path, i) => {
    const bytes = Buffer.from(plan.writes.get(path) ?? '');
    stream.push(Buffer.from(`blob\nmark :${i + 1}\ndata ${bytes.length}\n`), bytes, Buffer.from('\n'));
  });
  execFileSync('git', ['fast-import', '--quiet', `--export-marks=${marks}`], { cwd: root, env, input: Buffer.concat(stream) });
  const oids = new Map(readFileSync(marks, 'utf8').trim().split('\n').map(row => { const [mark, oid] = row.split(' '); return [blobs[Number(mark?.slice(1)) - 1], oid]; }));
  run(['read-tree', tree.head]);
  const headOids = new Map(run(['ls-files', '-s', '-z']).split('\0').filter(Boolean).map(row => { const [meta, path] = row.split('\t'); return [path, meta?.split(' ')[1]]; }));
  const row = (path, to) => `${tree.modes.get(path)} ${oids.get(path) ?? headOids.get(path)}\t${to}`, rows = [];
  for (const [path, to] of plan.moves) rows.push(`0 ${'0'.repeat(40)}\t${path}`, row(path, to));
  for (const path of blobs) if (!plan.moves.has(path)) rows.push(row(path, path));
  run(['update-index', '-z', '--index-info'], `${rows.join('\0')}\0`);
  const candidate = run(['write-tree']).trim();
  const commit = run(['-c', 'user.name=sort-sides', '-c', 'user.email=sort@local', 'commit-tree', candidate, '-p', tree.head, '-m', 'sort-sides candidate']).trim();
  return { env, commit };
}

/** What git itself detects for the candidate. */
export function renameProof(root, plan, { env, commit }) {
  const status = execFileSync('git', ['diff', '--name-status', '-M50%', '-l0', 'HEAD', commit], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 30 }).split('\n').filter(Boolean);
  const count = { exact: 0, edited: 0, lost: 0 }, lostFiles = [];
  for (const row of status) {
    const [state, from] = row.split('\t');
    if (state === 'R100') count.exact++;
    else if (state?.startsWith('R')) count.edited++;
    else if (state === 'D' && from !== undefined && plan.moves.has(from)) { count.lost++; lostFiles.push(from); }
  }
  const worst = status.flatMap(row => /^R(\d+)/u.exec(row)?.[1] ?? []).map(Number).sort((a, b) => a - b)[0];
  return { ...count, worst: worst ?? null, lostFiles };
}

/** One phase as scripts/push-loop.py runs it on a tip: its checker, its path list. A rename is a delete plus an add there.
 * A candidate lives in a private object store, so `env` is what lets git find it.
 * @returns {string[]} */
export function gatePhaseCommand(root, base, tip, phase, env) {
  if (phase === 'binary-json') return ['scripts/no-binary-json.mjs', '--range', base, tip];
  const paths = git(root, ['diff', '--name-only', ...(phase === 'deleted-paths' ? ['--diff-filter=D'] : []), '--no-renames', base, tip], { env }).split('\n').filter(Boolean);
  return ['scripts/committed-fast-checks.mjs', root, base, tip, phase, JSON.stringify(paths)];
}

/** The push gate's own committed checks, run on the candidate's blobs. A failed phase is a verdict, not a crash.
 * @returns {Record<string, string>} */
export function gateProof(root, { env, commit }, phases) {
  const base = git(root, ['rev-parse', 'HEAD']).trim(), verdicts = {};
  for (const phase of phases) {
    const started = Date.now(), result = spawnSync('node', gatePhaseCommand(root, base, commit, phase, env), { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 280_000 });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n');
    const local = output.some(line => /Error: Missing committed input: /u.test(line)) && output.filter(line => /deleted path|rose|Refused|REFUSED/u.test(line)).length === 0;
    verdicts[phase] = `${result.status === 0 ? 'pass' : local ? 'pass but for gen-source, which resolves through the real node_modules and proves only after --apply' : `FAIL ${result.status ?? 'timeout'}`} in ${Math.round((Date.now() - started) / 1000)}s: ${output.slice(result.status === 0 ? -1 : 0, 40).join(' | ').slice(0, 4000)}`;
  }
  return verdicts;
}

/** The tree-wide census checks, each over HEAD's blobs and then the candidate's. @returns {Record<string, {before: string, after: string, same: boolean}>} */
export function censusProof(root, tree, { env, commit }) {
  const self = resolve(root, 'scripts/sort-sides.mjs'), verdicts = {};
  const run = (rev, check) => {
    const result = spawnSync('node', [self, '--view', rev, ...check], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 280_000 });
    return `${result.status}: ${(result.stdout ?? '').trim().split('\n').at(-1) ?? ''}`.replaceAll(/src\/(engine|game)\/(?:client|cook|server|shared)\//gu, 'src/$1/');
  };
  for (const check of CENSUS_CHECKS) {
    const before = run(tree.head, check), after = run(commit, check);
    verdicts[check.join(' ')] = { before, after, same: before === after };
  }
  return verdicts;
}

function summary(tree, plan, failures) {
  const bySide = {};
  for (const to of plan.moves.values()) { const key = to.split('/').slice(1, 3).join('/'); bySide[key] = (bySide[key] ?? 0) + 1; }
  const noteCounts = {};
  for (const note of plan.notes) noteCounts[note.kind] = (noteCounts[note.kind] ?? 0) + 1;
  const edited = [...plan.writes.keys()], movedEdited = edited.filter(path => plan.moves.has(path)).length;
  return { head: tree.head, moves: plan.moves.size, bySide, kept: plan.kept.length, derived: plan.derived, rewritten: edited.length, movedAndEdited: movedEdited, movedPure: plan.moves.size - movedEdited, stale: plan.stale, crossSideTests: plan.crossSideTests.length, notes: noteCounts, failures: failures.length };
}

function writePlan(root, tree, plan, failures, extra) {
  mkdirSync(resolve(root, dirname(PLAN_FILE)), { recursive: true });
  const about = summary(tree, plan, failures);
  writeFileSync(resolve(root, PLAN_FILE), `${JSON.stringify({ ...about, ...extra, moves: Object.fromEntries(plan.moves), rewrites: [...plan.writes.keys()], kept: plan.kept, crossSideTests: plan.crossSideTests, notes: plan.notes, dividedDirectories: [...plan.dirMoves.divided], failures }, null, 1)}\n`);
  return about;
}

/** Disk half of --apply: a pure rename for every move, then the rewritten bytes. */
export function applyPlan(root, tree, plan) {
  for (const [from, to] of plan.moves) {
    mkdirSync(dirname(resolve(root, to)), { recursive: true });
    renameSync(resolve(root, from), resolve(root, to));
    for (let dir = dirname(from); dir !== 'src'; dir = dirname(dir)) { if (readdirSync(resolve(root, dir)).length > 0) break; rmdirSync(resolve(root, dir)); }
  }
  for (const [path, text] of plan.writes) {
    const at = resolve(root, plan.moves.get(path) ?? path), mode = statSync(at).mode;
    writeFileSync(at, text);
    chmodSync(at, mode);
  }
}


/** Back to HEAD after a failed apply. The tree was clean when it started, so every change here is the sort's. */
export function undoApply(root) {
  const planned = JSON.parse(readFileSync(resolve(root, PLAN_FILE), 'utf8'));
  if (planned.head !== git(root, ['rev-parse', 'HEAD']).trim()) throw new Error(`sort-sides: HEAD moved past ${planned.head}; nothing to undo`);
  const rows = changedPaths(root), list = resolve(root, 'tmp/sort/undo.list');
  for (const { state, path } of rows) if (state === '??') rmSync(resolve(root, path));
  const tracked = rows.filter(row => row.state !== '??').map(row => row.path);
  if (tracked.length > 0) {
    writeFileSync(list, `${tracked.join('\0')}\0`);
    git(root, ['restore', '--source=HEAD', '--staged', '--worktree', `--pathspec-from-file=${list}`, '--pathspec-file-nul']);
    rmSync(list);
  }
  const prune = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) { prune(resolve(dir, entry.name)); if (readdirSync(resolve(dir, entry.name)).length === 0) rmdirSync(resolve(dir, entry.name)); } };
  for (const layer of LAYERS) prune(resolve(root, 'src', layer));
}

/** The committed source tables hold paths in the order of the paths: regenerate them from the sorted tree. */
function regenerate(root) {
  const result = spawnSync('node', ['--import', './scripts/bake-loader.mjs', 'scripts/gen-source.mjs'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`sort-sides: gen-source exited ${result.status}; run --undo, fix forward, rerun`);
}

function commitPlan(root, plan, agent) {
  const files = changedPaths(root).map(row => row.path);
  const message = `refactor(src): sort engine and game by side\n\nJ122: ${plan.moves.size} files move into client/, shared/, server/\nand cook/ by lint/engine-sides.json with scripts/sort-sides.mjs.\nPaths and specifiers only; no logic changes.\n\nAssisted-by: ${agent}`;
  const result = spawnSync('scripts/commit.sh', [message, '--', ...files], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`sort-sides: commit.sh exited ${result.status}; the tree is applied and uncommitted: run --undo`);
}

/** What the side ratchet reads for a candidate: its table, or the rise that refuses it. */
function candidateEdges(root, tree, { env, commit }) {
  const result = spawnSync('node', [resolve(root, 'scripts/sort-sides.mjs'), '--view', commit, 'scripts/check-engine-sides.mjs', '--print'], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 280_000 });
  return result.status === 0 ? { table: result.stdout } : { failure: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

function landMove(root, tree, plan, candidate, scratch, subject, agent) {
  const patch = resolve(scratch, 'move.patch'), { env, commit } = candidate;
  writeFileSync(patch, execFileSync('git', ['diff', '--binary', '--full-index', '-M50%', tree.head, commit], { cwd: root, env, maxBuffer: 1 << 30 }));
  const files = [...new Set([...plan.moves.keys(), ...plan.moves.values(), ...plan.writes.keys()])];
  const message = `${subject}\n\nLEAVES: ${plan.moves.size} files change side with\nscripts/sort-sides.mjs --move. Paths and specifiers only.\n\nAssisted-by: ${agent}`;
  return spawnSync('scripts/commit.sh', ['--patch', patch, message, '--', ...files], { cwd: root, stdio: 'inherit' }).status === 0;
}

/** Empty folders a moved file left: git keeps no record of them, and the sorted layout should not either. */
function pruneMoved(root, plan) {
  for (const from of plan.moves.keys()) for (let dir = dirname(from); dir !== 'src' && dir !== '.'; dir = dirname(dir)) {
    const at = resolve(root, dir);
    try { if (readdirSync(at).length > 0) break; rmdirSync(at); } catch { break; }
  }
}

/** `--move` on any tree: plan from HEAD, prove, commit a patch, and only then touch what the patch did not advance. */
function moveMain(argv, root) {
  const all = flag => argv.flatMap((arg, i) => arg === flag ? [argv[i + 1]] : []), one = flag => all(flag)[0];
  const paths = all('--move'), side = one('--to'), apply = argv.includes('--apply'), agent = one('--agent');
  if (side === undefined || paths.some(path => path === undefined)) { console.error('sort-sides: --move <path> … --to <side>'); return 2; }
  if (apply && agent === undefined) { console.error('sort-sides: --apply needs --agent <name:model>'); return 2; }
  const subject = one('--message') ?? `refactor(src): move ${paths.length} files to ${side}`;
  const head = headTree(root), { tree, plan } = planMove(head, paths, side), failures = planFailures(tree, plan, root);
  const scratch = resolve(root, `tmp/sort/move-${process.pid}`), objects = resolve(scratch, 'candidate');
  try {
    if (failures.length > 0) { console.error(`sort-sides: ${failures.length} failures, the first:\n  ${failures.slice(0, 40).join('\n  ')}`); return 1; }
    mkdirSync(scratch, { recursive: true });
    const first = candidateCommit(root, head, plan, objects), edges = candidateEdges(root, head, first);
    if (edges.table === undefined) { console.error(`sort-sides: the side ratchet refuses this move:\n${edges.failure}`); return 1; }
    plan.writes.set(EDGES_FILE, edges.table);
    const before = JSON.parse(head.text.get(EDGES_FILE) ?? '{}').totals, after = JSON.parse(edges.table).totals;
    console.log(JSON.stringify({ moves: Object.fromEntries(plan.moves), rewritten: plan.writes.size, edges: { before, after } }, null, 1));
    if (!apply) { console.log('sort-sides: dry run clean'); return 0; }
    const candidate = candidateCommit(root, head, plan, objects);
    if (!landMove(root, head, plan, candidate, scratch, subject, agent)) { console.error('sort-sides: commit.sh refused; nothing moved, rerun against fresh inputs'); return 1; }
    const { carried, refused } = carryWorkingText(root, tree, plan, paths, side, { committed: new Map([[EDGES_FILE, edges.table]]), scratch });
    pruneMoved(root, plan);
    if (carried.length > 0) console.log(`sort-sides: carried other lanes' working text: ${carried.join(', ')}`);
    if (refused.length > 0) { console.error(`sort-sides: landed, but these working files conflict and need a hand: ${refused.join(', ')}`); return 1; }
    console.log(`sort-sides: moved ${plan.moves.size} files to ${side}`);
    return 0;
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** @param {string[]} argv @param {string} root */
export function main(argv, root = process.cwd()) {
  if (argv.includes('--undo')) { undoApply(root); console.log('sort-sides: tree is back at HEAD'); return 0; }
  if (argv.includes('--move')) return moveMain(argv, root);
  const apply = argv.includes('--apply'), agentAt = argv.indexOf('--agent'), agent = agentAt === -1 ? undefined : argv[agentAt + 1];
  if (apply && agent === undefined) { console.error('sort-sides: --apply needs --agent <name:model>'); return 2; }
  if (apply && !cleanTree(root)) { console.error('sort-sides: refusing a dirty tree; commit or clear it first'); return 1; }
  const tree = headTree(root), plan = planSort(tree), failures = planFailures(tree, plan, root);
  const extra = {}, proving = argv.includes('--rename-proof') || argv.includes('--gate-proof');
  if (proving && plan.moves.size > 0) {
    const scratch = resolve(root, 'tmp/sort/candidate'), candidate = candidateCommit(root, tree, plan, scratch);
    extra.renames = renameProof(root, plan, candidate);
    if (argv.includes('--gate-proof')) { extra.gate = gateProof(root, candidate, GATE_PHASES); extra.census = censusProof(root, tree, candidate); }
    rmSync(scratch, { recursive: true, force: true });
  }
  const about = writePlan(root, tree, plan, failures, extra);
  console.log(JSON.stringify({ ...about, ...extra }, null, 1));
  if (failures.length > 0) { console.error(`sort-sides: ${failures.length} failures, the first:\n  ${failures.slice(0, 40).join('\n  ')}`); return 1; }
  if (!apply) { console.log(`sort-sides: dry run clean; plan in ${PLAN_FILE}`); return 0; }
  if (plan.moves.size === 0 && plan.writes.size === 0) { console.log('sort-sides: already sorted'); return 0; }
  applyPlan(root, tree, plan);
  regenerate(root);
  commitPlan(root, plan, agent);
  console.log(`sort-sides: moved ${plan.moves.size} files, rewrote ${plan.writes.size}`);
  return 0;
}

/** `--view <rev> <script> [args]`: one repo check, reading a commit's blobs instead of the working tree. */
async function viewCheck([rev, script, ...rest]) {
  const { gitSourceView, installGitSourceView } = await import('./git-source-view.mjs');
  const view = gitSourceView(process.cwd(), rev);
  view.prime([...view.files.keys()].filter(path => /^(?:src|lint)\/.*\.(?:json|[cm]?[jt]sx?)$/u.test(path))); // one blob at a time is a minute
  installGitSourceView(view);
  process.argv = [process.argv[0] ?? 'node', resolve(script), ...rest];
  await import(pathToFileURL(resolve(script)).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--view') await viewCheck(process.argv.slice(3));
  else process.exitCode = main(process.argv.slice(2));
}
