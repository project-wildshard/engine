/** QA 11-25 row 137: a page runs one three.js. Each bundled copy of three's core sets `window.__THREE__` (or warns
 * `Multiple instances of Three.js being imported`), so a page whose scripts hold two copies downloads, parses and keeps
 * a second three.js. The online shell (`standaloneOutput.mjs`) is its own bundle, which the title loads by URL; on
 * v0.1.92 its `config-*.js` carried a whole app and three (626 KB) beside the session's own copy.
 *
 * A page's scripts here are every chunk its document's import map names, plus the shell entries the page imports at
 * runtime (`b/<build>/standalone/{online,identity,storage,shell}.js`) and everything they import. Workers run apart from
 * the page's `window` and are not followed: a shell reaches them through `new Worker(new URL(…))`, not an import. */
import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { chunkRequests, documentImportMap } from './importMap.mjs';
import { standaloneDirectory } from './standaloneOutput.mjs';

/** What only three's core writes: its page global. */
const WRITER = '__THREE__';
/** The shell modules a page imports by URL (`zoneSelect/served.ts`, `grid/oneWayIn.ts`, `app/entry.ts`). */
const SHELL_ENTRIES = ['online.js', 'identity.js', 'storage.js', 'shell.js'];

/** The written scripts a build's pages load, as paths under `outDir` with no leading slash.
 * @param {string} outDir @param {string} buildId @returns {string[]} */
export function pageScripts(outDir, buildId) {
  const root = resolve(outDir), file = (/** @type {string} */ path) => existsSync(`${root}${path}`);
  /** @type {Record<string, {file: string, isEntry?: boolean}>} */
  const manifest = JSON.parse(readFileSync(resolve(root, '.vite/manifest.json'), 'utf8'));
  /** @type {Record<string, string>} */
  const map = {};
  for (const [name, row] of Object.entries(manifest)) {
    if (row.isEntry !== true || !name.endsWith('.html')) continue;
    Object.assign(map, documentImportMap(name, readFileSync(resolve(root, name), 'utf8')) ?? {});
  }
  const seen = new Set(), queue = [...Object.values(map), ...Object.values(manifest).map(row => `/${row.file}`).filter(path => path.endsWith('.js')),
    ...SHELL_ENTRIES.map(name => `/${standaloneDirectory(buildId)}/${name}`).filter(file)];
  for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
    if (seen.has(url) || !file(url)) continue;
    seen.add(url);
    for (const request of chunkRequests(url.slice(1), readFileSync(`${root}${url}`, 'utf8'))) {
      const target = request.startsWith('/') ? request : posix.join(posix.dirname(url), request);
      queue.push(map[target] ?? target);
    }
  }
  return [...seen].map(url => url.slice(1)).sort();
}

/** The page scripts that hold a copy of three.js. @param {string} outDir @param {string} buildId @returns {string[]} */
export function threeCopies(outDir, buildId) {
  return pageScripts(outDir, buildId).filter(name => readFileSync(resolve(outDir, name), 'utf8').includes(WRITER));
}

/** Throws when a build's pages load more than one three.js. @param {string} outDir @param {string} buildId */
export function checkOneThree(outDir, buildId) {
  const copies = threeCopies(outDir, buildId);
  if (copies.length > 1) {
    throw new Error(`A page loads ${copies.length} copies of three.js (QA 11-25 row 137): ${copies.join(', ')}. `
      + 'Keep three out of the online shell\'s graph (src/client/host/online), or share the session\'s chunk.');
  }
  return { copies: copies.length };
}
