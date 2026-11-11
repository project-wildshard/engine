import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { parseSync } from 'vite';

/** J217 (LD6b): page chunks name each other through the document's import map (Vite's `build.chunkImportMap`), by keys
 * that never hold an importee's content hash, so a changed module renames only its own chunk and the build's entries.
 * A one-line change kept 28.6 % of code bytes at the same URL before, 98.7 % with the map. The map is one inline script
 * in each document. A browser without import maps (Safari before 16.4) can't boot this build. */

const MAP = /<script type="importmap">([\s\S]*?)<\/script>/gu;
/** Vite's preload helper's dependency table: keys too, resolved through the map by `import.meta.resolve`. */
const DEPS = /m\.f\|\|\(m\.f=\[([^\]]*)\]\)/gu;

/** @param {string} code @param {number} start @param {number} end */
function literal(code, start, end) {
  const text = code.slice(start, end).trim();
  return /^(["'`])([^"'`$\\]*)\1$/u.exec(text)?.[2];
}

/** Every module request a chunk makes by a literal: static imports, re-exports, dynamic imports and preload deps.
 * @param {string} fileName @param {string} code @returns {string[]} */
export function chunkRequests(fileName, code) {
  const parsed = parseSync(fileName, code, { lang: 'js', sourceType: 'module' });
  if (parsed.errors.length > 0) throw new Error(`Cannot read the imports of ${fileName}: ${parsed.errors.map(error => error.message).join('; ')}`);
  const requests = [...parsed.module.staticImports.map(row => row.moduleRequest.value),
    ...parsed.module.staticExports.flatMap(row => row.entries.flatMap(entry => entry.moduleRequest === null ? [] : [entry.moduleRequest.value])),
    ...parsed.module.dynamicImports.flatMap(row => { const value = literal(code, row.moduleRequest.start, row.moduleRequest.end); return value === undefined ? [] : [value]; })];
  for (const table of code.matchAll(DEPS)) for (const dep of (table[1] ?? '').matchAll(/"([^"]+)"/gu)) if (dep[1].endsWith('.js')) requests.push(`/${dep[1]}`);
  return requests;
}

/** The one import map of a document that loads module code, read before its first module script or preload.
 * @param {string} name @param {string} html @returns {Record<string, string> | null} */
export function documentImportMap(name, html) {
  const module = html.search(/<script\b[^>]*\btype="module"|<link\b[^>]*\brel="modulepreload"/u);
  if (module === -1) return null;
  const maps = [...html.matchAll(MAP)];
  if (maps.length !== 1) throw new Error(`${name} has ${maps.length} import maps; a page that loads chunks needs exactly one`);
  const [map] = maps;
  if (map === undefined || map.index > module) throw new Error(`${name}: the import map must come before the first module script or modulepreload`);
  /** @type {unknown} */
  const parsed = JSON.parse(map[1] ?? '');
  if (typeof parsed !== 'object' || parsed === null || !('imports' in parsed) || typeof parsed.imports !== 'object' || parsed.imports === null
    || Object.keys(parsed).length !== 1) throw new Error(`${name}: the import map holds only an imports table`);
  /** @type {Record<string, string>} */
  const imports = {};
  for (const [key, value] of Object.entries(parsed.imports)) {
    if (typeof value !== 'string' || !key.startsWith('/') || !value.startsWith('/')) throw new Error(`${name}: import map row ${key} is not a site path`);
    imports[key] = value;
  }
  return imports;
}

/** After the documents are final: every document that loads page chunks holds one import map first; every row names a
 * file this build wrote, and no key shadows a different written file; every literal request in every page chunk
 * reaches a written file, directly or through that map. A worker or shell bundle has no map: its own requests must
 * reach files directly.
 * @param {string} outDir @returns {{documents: number, rows: number, chunks: number, mapped: number}} */
export function checkImportMaps(outDir) {
  const root = resolve(outDir), file = (/** @type {string} */ path) => existsSync(`${root}${path}`);
  /** @type {Record<string, {file: string, isEntry?: boolean}>} */
  const manifest = JSON.parse(readFileSync(resolve(root, '.vite/manifest.json'), 'utf8'));
  const documents = Object.entries(manifest).filter(([name, row]) => row.isEntry === true && name.endsWith('.html')).map(([name]) => name);
  if (documents.length === 0) throw new Error('No page document in the build manifest');
  /** @type {Record<string, string> | undefined} */
  let shared;
  for (const name of documents) {
    const map = documentImportMap(name, readFileSync(resolve(root, name), 'utf8'));
    if (map === null) throw new Error(`${name} loads no module code`);
    for (const [key, value] of Object.entries(map)) {
      if (!file(value)) throw new Error(`${name}: import map row ${key} names ${value}, which this build did not write`);
      if (key !== value && file(key)) throw new Error(`${name}: import map key ${key} shadows a written file`);
    }
    if (shared !== undefined && JSON.stringify(shared) !== JSON.stringify(map)) throw new Error(`${name}'s import map differs from ${documents[0]}'s; shared chunks would resolve differently`);
    shared = map;
  }
  const map = shared ?? {};
  let chunks = 0, mapped = 0;
  for (const row of Object.values(manifest)) {
    if (!row.file.endsWith('.js')) continue;
    const url = `/${row.file}`;
    chunks++;
    for (const request of chunkRequests(row.file, readFileSync(resolve(root, row.file), 'utf8'))) {
      if (!request.startsWith('/') && !request.startsWith('./') && !request.startsWith('../')) throw new Error(`${row.file} requests bare ${request}`);
      const target = request.startsWith('/') ? request : posix.join(posix.dirname(url), request);
      const value = map[target];
      if (value !== undefined) { mapped++; continue; }
      if (!file(target)) throw new Error(`${row.file} requests ${request}, which is neither a written file nor in the import map`);
    }
  }
  return { documents: documents.length, rows: Object.keys(map).length, chunks, mapped };
}
