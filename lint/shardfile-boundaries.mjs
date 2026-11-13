// G450 / shardfile design §3.3. Shared by oxlint and the verbatim runtime copier.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseSync } from 'vite';
import { shardFile } from './shard-source.mjs';

const BUILD = /^(?:data|generators|bake|behaviour|assets|blender)(?:\/|$)|^shard\.config(?:\.[cm]?[jt]s)?$/u;
const PLAY = /^(?:runtime|world|look|models|weapons|quest|quests|combat|species|creatures|npc|loadout|ride|vm|grapple|life|compendium|boot|debug|dev|playground|explore|audio|loot|onboarding)(?:\/|$)/u;
/** [source path, slug, shard-local path] for `path` (relative to `root`, either layout, SA45), or null. */
const shard = (root, path) => { const found = shardFile(root, path); return found === null ? null : [found.path, found.slug, found.local]; };
const text = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value
  : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0]?.value.cooked ?? null : null;
const prefix = node => text(node) ?? (node?.type === 'TemplateLiteral' ? node.quasis[0]?.value.cooked
  : node?.type === 'BinaryExpression' && node.operator === '+' ? prefix(node.left) : null);
const member = (node, name) => node?.type === 'MemberExpression' && (node.computed ? text(node.property) : node.property?.name) === name;
const importMeta = node => node?.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta';
const packages = new Map();

function publicPackage(root, source) {
  if (source === 'three' || source.startsWith('three/') || source === 'valibot') return true;
  const pkg = /^@wildshard\/(engine|game|sdk|sharddev|format)(?:\/(.+))?$/u.exec(source);
  if (pkg === null) return false;
  const file = resolve(root, 'src', pkg[1], 'package.json');
  if (!packages.has(file)) packages.set(file, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).exports ?? {} : {});
  const sub = pkg.at(2);
  return Object.hasOwn(packages.get(file), sub === undefined ? '.' : `./${sub}`);
}

function target(root, file, source) {
  const clean = source.replace(/[?#].*$/u, '');
  if (clean.startsWith('.')) return relative(root, resolve(root, dirname(file), clean)).replaceAll('\\', '/');
  if (clean.startsWith('/src/')) return clean.slice(1);
  if (clean.startsWith('src/')) return clean;
  const absolute = relative(root, clean).replaceAll('\\', '/');
  return absolute.startsWith('src/') ? absolute : null;
}

function violation(root, file, source, computed, glob, rule) {
  const own = shard(root, file), dest = source === null ? null : target(root, file, source);
  const other = dest === null ? null : shard(root, dest);
  const build = own !== null && BUILD.test(own[2]);
  if (rule === 'runtime-standalone') {
    if (own === null || !own[2].startsWith('runtime/')) return null;
    if (computed || source === null) return 'runtime/ imports must have a statically closed path';
    if (/[?#]/u.test(source)) return 'runtime/ cannot import assets, JSON, ?raw or ?url; read the admitted product instead';
    if (/\.[^/]+$/u.test(source) && !/\.[cm]?[jt]sx?$/u.test(source)) return `runtime/ cannot import JSON or assets: ${source}; read the admitted product instead`;
    if (dest === null) return publicPackage(root, source) ? null : `runtime/ imports only its own files and public engine/game/SDK/format, three or valibot modules: ${source}`;
    if (other?.[1] !== own[1] || !other[2].startsWith('runtime/')) return `runtime/ is standalone: ${source} leaves its own runtime/; read a built section or move play code into runtime/`;
    if (/\.[^/]+$/u.test(dest) && !/\.[cm]?tsx?$/u.test(dest) || glob && !/\.[cm]?tsx?$/u.test(dest)) return `runtime/ cannot import JSON or assets: ${source}; read the admitted product instead`;
    return null;
  }
  if (rule === 'no-build-time-import') {
    if (!file.startsWith('src/') || file.startsWith('src/commons/') || /^src\/sharddev\/(?:cli|bake)\//u.test(file)) return null;
    if (other === null || !BUILD.test(other[2])) {
      return computed && (other !== null || dest?.startsWith('src/shards/') === true) && !build ? `Play code cannot compute a path into shard build-time folders: ${source}` : null;
    }
    if (build && own[1] === other[1]) return null;
    return `Play code cannot import build-time code: ${source}; read it from the built shard's sections or blobs`;
  }
  if (!build || other === null) return null;
  if (PLAY.test(other[2]) || (!BUILD.test(other[2]) && /\.[cm]?[jt]sx?$/u.test(other[2]))) return `Build-time code cannot import play code: ${source}; move shared facts into data/ and read the output at runtime`;
  // Extensionless imports of legacy root play modules (plugin, roster, layout, etc.).
  if (!BUILD.test(other[2]) && !other[2].includes('/') && !/\./u.test(other[2])) return `Build-time code cannot import legacy play code: ${source}; declare build facts in data/`;
  return null;
}

/** Same AST visitors for the linter and copier. Type-only, lazy and resource imports are all boundaries. */
export function shardfileBoundaryVisitors(root, file, rule, report) {
  const own = shard(root, file);
  if (rule === 'runtime-standalone' && !own?.[2].startsWith('runtime/')) return {};
  if (rule === 'no-runtime-in-build' && (own === null || !BUILD.test(own[2]))) return {};
  const check = (node, raw, glob = false) => {
    const source = prefix(raw) ?? null;
    const reason = violation(root, file, source, text(raw) === null, glob, rule);
    if (reason !== null) report(node, reason);
  };
  return {
    ImportDeclaration(node) { check(node, node.source); },
    ExportNamedDeclaration(node) { if (node.source) check(node, node.source); },
    ExportAllDeclaration(node) { check(node, node.source); },
    ImportExpression(node) { check(node, node.source); },
    TSImportType(node) { check(node, node.source); },
    TSExternalModuleReference(node) { check(node, node.expression); },
    CallExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]);
      if ((member(node.callee, 'glob') || member(node.callee, 'globEager')) && importMeta(node.callee.object)) {
        const raw = node.arguments[0], patterns = raw?.type === 'ArrayExpression' ? raw.elements : [raw];
        if (rule === 'runtime-standalone' && own?.[2].startsWith('runtime/') && node.arguments[1]?.type === 'ObjectExpression'
          && node.arguments[1].properties.some(property => ['query', 'as'].includes(property.key?.name ?? text(property.key)))) {
          report(node, 'runtime/ globs cannot transform modules into assets with query/as');
        }
        for (const pattern of patterns) {
          // Negative glob patterns only remove files; positive patterns must prove the boundary.
          if (!(text(pattern) ?? '').startsWith('!')) check(node, pattern, true);
        }
      }
    },
    NewExpression(node) {
      if (node.callee.type === 'Identifier' && node.callee.name === 'URL' && member(node.arguments[1], 'url') && importMeta(node.arguments[1].object)) check(node, node.arguments[0]);
    },
  };
}

/** Raw violations, without migration allowances. `file` is relative to `root`: src/shards/<slug>/... or a single-shard src/... (SA45).
 * @returns {{rule: string, message: string, start: number, end: number}[]} */
export function shardfileBoundaryViolations(root, file, source) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length > 0) throw new Error(`Cannot check shard imports: ${file}: ${parsed.errors[0].message}`);
  const found = [];
  for (const rule of ['runtime-standalone', 'no-build-time-import', 'no-runtime-in-build']) {
    const visitors = shardfileBoundaryVisitors(root, file, rule, (node, message) => found.push({ rule, message, start: node.start, end: node.end }));
    const walk = node => {
      if (node === null || typeof node !== 'object') return;
      if (node.type !== undefined) visitors[node.type]?.(node);
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent' || key === 'comments') continue;
        if (Array.isArray(value)) { for (const child of value) walk(child); }
        else if (value !== null && typeof value === 'object') walk(value);
      }
    };
    walk(parsed.program);
  }
  return found;
}
