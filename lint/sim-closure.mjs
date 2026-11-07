import { exportedPath } from './layer-exports.mjs';
import { currentSources, sourceStamp } from './source-stamps.mjs';
// SF3a: runtime dependency graph shared by oxlint and the measured, shrink-only baseline.
import { existsSync, readFileSync, globSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parseSync } from 'vite';

const VIEW = /^src\/(?:client|cook|server|shared)\/engine\/(?:app\/view\/|ai\/view\/|combat\/view\/|quest\/view(?:\/|\.ts$)|saves\/view\/|entities\/AnimalView\.ts$)/u;
const FORBIDDEN = /^src\/(?:client|cook|server|shared)\/engine\/(?:app\/runtime(?:\.ts)?$|core\/(?:tier|frameCost)(?:\.ts)?$|render\/|ui\/|fx\/|anim\/)/u;
export const MATH = new Set(['Vector2', 'Vector3', 'Vector4', 'Euler', 'Quaternion', 'Matrix3', 'Matrix4', 'Box2', 'Box3', 'Ray', 'Sphere', 'Plane', 'Frustum', 'MathUtils', 'Color']);
export const DOM = new Set(['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement', 'HTMLCanvasElement', 'Element', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'ResizeObserver', 'Image', 'Audio']);
export const simRoot = (path) => /^src\/(?:engine\/(?:ai|combat|events|quest|saves)\/|shards\/[^/]+\/(?:data|behaviour)\/|engine\/entities\/AnimalSim\.ts$|engine\/sim(?:\.ts$|\/))/u.test(path) && !VIEW.test(path);
const astCache = new Map();
const eventCache = new WeakMap();
function parsed(file) {
  const text = readFileSync(file, 'utf8');
  const cached = astCache.get(file);
  if (cached?.text === text) return cached.program;
  const result = parseSync(file, text);
  if (result.errors.length > 0) throw new Error(`Cannot parse sim dependency: ${file}`);
  astCache.set(file, { text, program: result.program });
  return result.program;
}
function target(root, file, source, observed) {
  const pkg = /^@wildshard\/(engine|format|game|sdk|sharddev|commons)\/(.+)$/u.exec(source);
  const base = pkg ? resolve(root, 'src', pkg[1], pkg[2]) : source.startsWith('.') ? resolve(dirname(file), source) : null;
  if (base === null) return null;
  const exported = pkg ? exportedPath(pkg[1], pkg[2], root) : null;
  return [...exported === null ? [] : [resolve(root, exported)], base, `${base}.ts`, `${base}.js`, base.replace(/\.js$/u, '.ts'), `${base}/index.ts`].find((p) => { observed.set(p, sourceStamp(p)); return existsSync(p) && statSync(p).isFile(); }) ?? null;
}
const value = (node) => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parent);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'parent' || key === 'comments') continue;
    if (Array.isArray(child)) for (const item of child) walk(item, visit, node);
    else if (child && typeof child === 'object') walk(child, visit, node);
  }
}
// Cache only local syntax candidates, never a closure verdict or resolved edge.
// parsed() still checks current bytes; every visit keeps its own path and trace.
function events(program) {
  let entries = eventCache.get(program);
  if (entries !== undefined) return entries;
  entries = [];
  walk(program, (node, parent) => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)
      || node.type === 'Identifier' && DOM.has(node.name)
      || node.type === 'MemberExpression' && ['window', 'globalThis'].includes(node.object?.name)) entries.push({ node, parent });
  });
  eventCache.set(program, entries);
  return entries;
}
export function reference(node, parent) {
  if (!parent || parent.type.startsWith('TS')) return false;
  if (['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier', 'ExportSpecifier'].includes(parent.type)) return false;
  if (['MemberExpression', 'Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type) && parent.property === node && !parent.computed) return false;
  if (['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type) && parent.key === node && !parent.computed) return false;
  if (['VariableDeclarator', 'FunctionDeclaration', 'ClassDeclaration'].includes(parent.type) && parent.id === node) return false;
  return true;
}
const closureResults = new Map();
export function simClosure(root, entries = globSync('src/**/*.ts', { cwd: root }).filter(simRoot)) {
  const key = JSON.stringify([root, entries]), cached = closureResults.get(key);
  const copy = rows => rows.map(row => ({ ...row, trace: [...row.trace] }));
  if (cached !== undefined && currentSources(cached.observed)) return copy(cached.rows);
  const observed = new Map();
  const seen = new Set(), violations = new Map();
  const visit = (path, trace) => {
    if (seen.has(path)) return;
    seen.add(path);
    const file = resolve(root, path), next = [];
    const add = (kind, token) => {
      const id = `${path}:${kind}:${token}`;
      const item = violations.get(id) ?? { id, count: 0, trace };
      item.count++; violations.set(id, item);
    };
    const inspect = (node, parent) => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
        if (simRoot(path) && value(node.source) === 'three' && node.importKind === 'type' && node.specifiers?.some((s) => s.type !== 'ImportSpecifier' || !MATH.has(s.imported.name))) add('import', 'three');
        if (node.importKind === 'type' || node.exportKind === 'type' || (node.specifiers?.length && node.specifiers.every((s) => s.importKind === 'type'))) return;
        const source = value(node.source);
        if (source === null) { if (node.source) add('import', 'dynamic'); return; }
        if (source === 'three' || source.startsWith('three/')) {
          if (source !== 'three' || !node.specifiers?.length || node.specifiers.some((s) => s.importKind !== 'type' && (s.type !== 'ImportSpecifier' || !MATH.has(s.imported.name)))) add('import', source);
          return;
        }
        // Format's own closure is the shardfile repo's to hold: only valibot and its Wasm decoder.
        if (source.startsWith('@wildshard/format/')) return;
        const dest = target(root, file, source, observed);
        if (dest === null) {
          if (source.startsWith('.') || source.startsWith('@wildshard/')) add('unresolved', source);
          return;
        }
        const destPath = relative(root, dest).replaceAll('\\', '/');
        if (FORBIDDEN.test(destPath) || VIEW.test(destPath)) add('import', destPath);
        else if (/\.[cm]?[jt]s$/u.test(destPath)) next.push(destPath);
      }
      if (simRoot(path) && node.type === 'Identifier' && ['HTMLElement', 'HTMLCanvasElement'].includes(node.name) && parent?.type === 'TSTypeReference') add('global', node.name);
      if (node.type === 'MemberExpression' && ['window', 'globalThis'].includes(node.object?.name) && DOM.has(node.property?.name) && node.property?.name !== 'window') add('global', node.property.name);
      if (node.type === 'Identifier' && reference(node, parent) && DOM.has(node.name)) add('global', node.name);
    };
    observed.set(file, sourceStamp(file));
    for (const { node, parent } of events(parsed(file))) inspect(node, parent);
    for (const dest of next) visit(dest, [...trace, dest]);
  };
  for (const entry of entries) visit(entry, [entry]);
  const rows = [...violations.values()].sort((a, b) => a.id.localeCompare(b.id));
  closureResults.set(key, { observed, rows });
  return copy(rows);
}
