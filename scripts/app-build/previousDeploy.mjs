/** MF2, J79: publish this build's files and carry the graphs of the builds before it, so a tab still running one of them
 * finds every file it names. The production alias serves only the live deployment, so a kept old deployment cannot do
 * this: the files must sit inside the live one. As many builds as the prune keeps, this one included. A build whose
 * files production no longer has drops out whole, and chunk recovery moves its tabs on.
 * This is a plain output step, never a bundler plugin or a runtime prefetch. */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {KEEP_PROMOTED} from '../prune-deployments.mjs';
import {SHARED_CODE_DIRECTORY, codeDirectory} from './buildIdentity.mjs';

const MANIFEST = 'deploy-chunks.json', LANES = 16;
const CHUNK = /^(?:assets\/(?:[\w.-]+\/)*[\w.-]+-[\w-]{8,64}\.(?:js|css|wasm|json|bin|woff2?|png|webp|jpg|svg)|b\/[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|css|wasm|html))$/u;
/** @typedef {{path: string, bytes: number}} Row */
/** @typedef {{build: string, files: Row[]}} Graph */
/** @param {unknown} files @returns {Row[]} */
function readRows(files) {
  if (!Array.isArray(files)) throw new Error('Invalid previous deploy chunk manifest');
  const seen = new Set();
  return files.map(row => {
    if (typeof row !== 'object' || row === null || typeof row.path !== 'string' || !CHUNK.test(row.path)
      || row.path.split('/').includes('..') || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || seen.has(row.path)) throw new Error('Invalid previous deploy chunk row');
    seen.add(row.path);
    return {path: row.path, bytes: row.bytes};
  });
}
/** Newest first. Format 1 is the single graph production published before the pointer.
 * @param {unknown} value @returns {Graph[]} */
function readManifest(value) {
  if (typeof value !== 'object' || value === null || !('format' in value)) throw new Error('Invalid previous deploy chunk manifest');
  if (value.format === 1 && 'build' in value && typeof value.build === 'string' && 'files' in value) return [{build: value.build, files: readRows(value.files)}];
  if (value.format !== 2 || !('builds' in value) || !Array.isArray(value.builds)) throw new Error('Invalid previous deploy chunk manifest');
  return value.builds.map(row => {
    if (typeof row !== 'object' || row === null || typeof row.build !== 'string') throw new Error('Invalid previous deploy chunk manifest');
    return {build: row.build, files: readRows(row.files)};
  });
}
/** @param {string} directory @returns {Graph} */
function currentManifest(directory) {
  const version = JSON.parse(readFileSync(join(directory, 'version.json'), 'utf8'));
  if (typeof version.build !== 'string') throw new Error('Missing deploy build identity');
  const files = [];
  // J217: the shared folder holds this build's content-named code next to the graphs it carries in below
  for (const folder of new Set(['assets', codeDirectory(version.build), SHARED_CODE_DIRECTORY])) {
    const root = join(directory, folder);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, {recursive: true, withFileTypes: true})) {
      if (!entry.isFile()) continue;
      const path = relative(directory, join(entry.parentPath, entry.name));
      if (CHUNK.test(path)) files.push({path, bytes: statSync(join(directory, path)).size});
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {build: version.build, files};
}
/** Production has moved past this build, or its bytes never arrived: not a reason to refuse this one. */
class GoneError extends Error { name = 'GoneError'; }
/** @param {string} path @param {string} origin @returns {Promise<Uint8Array>} */
async function fetchRow(path, origin) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(new URL(`/${path}`, origin), {signal: AbortSignal.timeout(30000)});
      if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) throw new GoneError(`Previous deploy chunk unavailable: ${path}`);
      if (!response.ok) throw new Error(`Previous deploy chunk returned ${response.status}: ${path}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof GoneError) throw error;
      if (attempt >= 3) throw new GoneError(`Previous deploy chunk unavailable: ${path}`, {cause: error});
      await new Promise(resolve => { setTimeout(resolve, attempt * 1000); });
    }
  }
}
/** @template T @param {readonly T[]} rows @param {(row: T) => Promise<void>} work */
async function pool(rows, work) {
  const pending = [...rows];
  /** @type {Error | undefined} */
  let failure;
  await Promise.all(Array.from({length: LANES}, async () => {
    for (let row = pending.shift(); row !== undefined; row = pending.shift()) {
      try { await work(row); } catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); pending.length = 0; }
    }
  }));
  if (failure !== undefined) throw failure;
}
/** The build the carried origin (or directory) serves right now: its version.json. Unknown is none.
 * @param {{previousDirectory?: string, previousOrigin?: string}} options @returns {Promise<string[]>} */
async function liveBuilds(options) {
  try {
    if (options.previousDirectory !== undefined) return [String(JSON.parse(readFileSync(join(options.previousDirectory, 'version.json'), 'utf8')).build)];
    if (options.previousOrigin === undefined) return [];
    const response = await fetch(new URL('/version.json', options.previousOrigin), {cache: 'no-store', signal: AbortSignal.timeout(30000)});
    return response.ok ? [String((await response.json()).build)] : [];
  } catch { return []; }
}
/** A build id `<sha7>-<stamp>` is this repository's when that commit is in its history.
 * @param {string} build @returns {boolean} */
function ownBuild(build) {
  const sha = build.split('-')[0] ?? '';
  if (!/^[0-9a-f]{7,40}$/u.test(sha)) return false;
  try { execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], {stdio: 'ignore'}); return true; } catch { return false; }
}

/** Carry files from a built previous output (local --rev proof), or production's published manifest. The new manifest
 * names each graph once; the build's own files stay unchanged, and a carried file is never a source map.
 * A kept graph that collides with a path this build writes is dropped with a warning, unless it is the build live at
 * the origin right now and that build is this repository's: open tabs on it lazy-load these chunks, so the build fails,
 * naming the file and the deploy. A live build from another repository (the singleplayer shell that J210 retires) is the
 * one this deploy replaces, so its clash is a warning.
 * @param {string} directory
 * A test build (`optional`) treats a 5xx or network failure fetching the origin's manifest as no previous builds.
 * @param {{previousDirectory?: string, previousOrigin?: string, live?: readonly string[], ours?: (build: string) => boolean, optional?: boolean}} [options]
 */
export async function carryPreviousDeploy(directory, options = {}) {
  const current = currentManifest(directory);
  /** @type {readonly string[] | undefined} */
  let live = options.live;
  const ours = options.ours ?? ownBuild;
  /** @type {Graph[]} */
  let previous = [];
  if (options.previousDirectory !== undefined) {
    previous = readManifest(JSON.parse(readFileSync(join(options.previousDirectory, MANIFEST), 'utf8')));
  } else if (options.previousOrigin !== undefined) {
    /** @type {Response | undefined} */
    let response;
    try {
      response = await fetch(new URL(`/${MANIFEST}`, options.previousOrigin), {cache: 'no-store', signal: AbortSignal.timeout(30000)});
    } catch (error) {
      if (options.optional !== true) throw error;
      console.warn(`Previous deploy manifest unavailable (${error instanceof Error ? error.message : String(error)} from ${options.previousOrigin}), so this test build carries no previous builds`);
    }
    // A test build may meet a paused or failing production (Vercel's spend cap answers 503 DEPLOYMENT_PAUSED, main ci
    // 43111080979): it warns and carries nothing. A release still refuses, so it never ships without the kept graphs.
    if (response !== undefined && options.optional === true && response.status >= 500) {
      console.warn(`Previous deploy manifest unavailable (${response.status} from ${options.previousOrigin}), so this test build carries no previous builds`);
      response = undefined;
    }
    // The first release of this output format has no predecessor manifest.
    if (response !== undefined && !response.ok && response.status !== 404) throw new Error(`Previous deploy manifest returned ${response.status}`);
    if (response !== undefined && response.status !== 404 && !response.headers.get('content-type')?.includes('text/html')) previous = readManifest(await response.json());
  }
  const held = new Map(current.files.map(row => [row.path, row.bytes])), kept = [current];
  let carried = 0, bytes = 0;
  for (const graph of previous.filter(row => row.build !== current.build).slice(0, KEEP_PROMOTED - 1)) {
    const fresh = [];
    // A path this build writes with other bytes than a kept build's: a chunk hash that doesn't cover what Vite adds after
    // hashing (`__vite__mapDeps`), seen across checkouts (main ci 43064007268). This build's bytes win and that kept build
    // is dropped whole, named in the log, rather than failing the build or serving a mixed graph.
    const clash = graph.files.find(row => held.has(row.path) && held.get(row.path) !== row.bytes);
    if (clash !== undefined) {
      const where = options.previousOrigin ?? options.previousDirectory ?? '';
      live ??= await liveBuilds(options); // read only on a clash
      if (live.includes(graph.build) && ours(graph.build)) throw new Error(`Immutable deploy chunk changed size: ${clash.path} in the live deploy ${graph.build} (${where})`);
      console.warn(`Dropped previous build ${graph.build}${live.includes(graph.build) ? ' (live, another repository\'s)' : ''}: ${clash.path} has other bytes in this build`);
      continue;
    }
    for (const row of graph.files) if (!held.has(row.path)) fresh.push(row);
    try {
      await pool(fresh, async row => {
        const target = join(directory, row.path);
        mkdirSync(dirname(target), {recursive: true});
        if (options.previousDirectory !== undefined) {
          const source = join(options.previousDirectory, row.path);
          if (statSync(source).size !== row.bytes) throw new Error(`Previous deploy chunk length differs: ${row.path}`);
          copyFileSync(source, target);
        } else {
          const body = await fetchRow(row.path, options.previousOrigin ?? '');
          if (body.byteLength !== row.bytes) throw new Error(`Previous deploy chunk length differs: ${row.path}`);
          writeFileSync(target, body);
        }
      });
    } catch (error) {
      if (!(error instanceof GoneError)) throw error;
      console.warn(`Dropped previous build ${graph.build}: ${error.message}`);
      for (const row of fresh) rmSync(join(directory, row.path), {force: true});
      continue;
    }
    for (const row of fresh) { held.set(row.path, row.bytes); carried++; bytes += row.bytes; }
    kept.push(graph);
  }
  writeFileSync(join(directory, MANIFEST), `${JSON.stringify({format: 2, builds: kept})}\n`);
  return {current: current.files.length, builds: kept.length, carried, bytes};
}
