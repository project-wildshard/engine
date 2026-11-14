/** MF2, J79: publish this build's files and carry the graphs of the builds before it, so a tab still running one of them
 * finds every file it names. The production alias serves only the live deployment, so a kept old deployment cannot do
 * this: the files must sit inside the live one. KEEP_PROMOTED builds, this one included. A build whose
 * files production no longer has drops out whole, and chunk recovery moves its tabs on.
 * This is a plain output step, never a bundler plugin or a runtime prefetch.
 * PAGE-SIZE PZ5 (J276): a build that reads its content from a content base (packs.wildshard.io) says so in its graph
 * (`content: true`) and names its code only, so a later release carries its code only. Its content is on R2, keyed by
 * hash, and `cook-worker gc` keeps every build a channel's live deploy-chunks.json names. A graph without the mark is a
 * build whose tabs read content from the page, so its content is carried as before until it ages out. */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {SHARED_CODE_DIRECTORY, codeDirectory} from './buildIdentity.mjs';

/** OFF-VERCEL OV5: how many builds a release carries, this one included. A Worker serves only its deployed version's
 * files, so the kept builds' files must sit inside it; it was the old host's prune window. */
export const KEEP_PROMOTED = 5;

const MANIFEST = 'deploy-chunks.json', LANES = 16;
/** A row an older manifest may name: code, and the content-named content the carry took before PZ5. */
const ROW = /^(?:assets\/(?:[\w.-]+\/)*[\w.-]+-[\w-]{8,64}\.(?:js|css|wasm|json|bin|woff2?|png|webp|jpg|svg)|b\/[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|css|wasm|html|json))$/u;
/** PZ5: what a carried build carries once its content is on R2. A build's code and its per-build JSON under `b/`, and the
 * content-named code an older build left at the top of `assets/` (format 1). Never `assets/spawn/`, a grid file or other content. */
export const CHUNK = /^(?:b\/[\w.-]+\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|css|wasm|html|json)|assets\/[\w.-]+-[\w-]{8,64}\.(?:js|css|wasm))$/u;
/** What a graph names and carries: code only for a build that reads its content from a content base, else content too.
 * @param {boolean | undefined} contentBase */
const carryOf = contentBase => (contentBase === true ? CHUNK : ROW);
/** @typedef {{path: string, bytes: number}} Row */
/** @typedef {{build: string, files: Row[], content?: true}} Graph  `content`: the build reads its content from a content base */
/** @param {unknown} files @returns {Row[]} */
function readRows(files) {
  if (!Array.isArray(files)) throw new Error('Invalid previous deploy chunk manifest');
  const seen = new Set();
  return files.map(row => {
    if (typeof row !== 'object' || row === null || typeof row.path !== 'string' || !ROW.test(row.path)
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
    if ('content' in row && row.content !== true) throw new Error('Invalid previous deploy chunk manifest');
    return {build: row.build, files: readRows(row.files), ...(row.content === true ? {content: /** @type {const} */ (true)} : {})};
  });
}
/** @param {string} directory @param {boolean} contentBase @returns {Graph} */
function currentManifest(directory, contentBase) {
  const carry = carryOf(contentBase);
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
      if (carry.test(path)) files.push({path, bytes: statSync(join(directory, path)).size});
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {build: version.build, files, ...(contentBase ? {content: /** @type {const} */ (true)} : {})};
}
/** Production has moved past this build, or its bytes never arrived: not a reason to refuse this one. */
class GoneError extends Error { name = 'GoneError'; }
/** The origin answered, and the answer refuses this build in every mode. */
class RefusedError extends Error { name = 'RefusedError'; }
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

/** @type {Readonly<Record<string, string>>} */
const CHANNEL_ORIGINS = Object.freeze({production: 'https://play.wildshard.io', staging: 'https://staging.wildshard.io', preview: 'https://preview.wildshard.io'});

/** PZ5: every build a channel's live deploy-chunks.json names. Garbage collection keeps them all, so a carried build's
 * book, parts and content stay on R2. A channel that does not answer with a manifest refuses: a collection that can't see
 * a channel's builds must not run.
 * @param {typeof fetch} [get] @param {Readonly<Record<string, string>>} [origins]
 * @returns {Promise<{channel: string, builds: string[]}[]>} */
export function liveDeployBuilds(get = fetch, origins = CHANNEL_ORIGINS) {
  return Promise.all(Object.entries(origins).map(async ([channel, origin]) => {
    const response = await get(new URL(`/${MANIFEST}`, origin), {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000)});
    if (!response.ok || response.headers.get('content-type')?.includes('text/html') === true) {
      await response.body?.cancel();
      throw new Error(`${channel} ${origin}/${MANIFEST} answered ${response.status}: no garbage collection without every channel's builds`);
    }
    const builds = readManifest(await response.json()).map(graph => graph.build);
    if (builds.length === 0) throw new Error(`${channel} ${origin}/${MANIFEST} names no build: no garbage collection without every channel's builds`);
    return {channel, builds};
  }));
}

/** Whether a 5xx or a network failure at the carried origin may mean "no previous builds" instead of failing the build.
 * ci.yml's test build opts in (WS_PREVIOUS_DEPLOY_OPTIONAL=1); a staging or production release (WS_RELEASE=1) never
 * does, so it never ships without the kept graphs. The hourly solo preview (OFF-VERCEL OV6) always does: its first
 * Workers release replaced a paused host that answered 503, and a missed hour costs an open preview tab a reload.
 * @param {Readonly<Record<string, string | undefined>>} env @returns {boolean} */
export function previousDeployOptional(env) {
  return (env.WS_PREVIOUS_DEPLOY_OPTIONAL === '1' && env.WS_RELEASE !== '1') || env.WS_CHANNEL === 'preview';
}

/** OFF-VERCEL OV3: a release carries the kept builds from its own channel's domain, never a vercel.app address. A main
 * push on CI names no channel and builds what production ships, so it carries from production.
 * @param {string | undefined} channel  WS_CHANNEL
 * @returns {string} */
export function channelOrigin(channel) {
  const name = channel === undefined || channel === '' ? 'production' : channel;
  const origin = Object.hasOwn(CHANNEL_ORIGINS, name) ? CHANNEL_ORIGINS[name] : undefined;
  if (origin === undefined) throw new Error(`WS_CHANNEL must be ${Object.keys(CHANNEL_ORIGINS).join(' or ')}, not ${name}`);
  return origin;
}

/** Carry files from a built previous output (local --rev proof), or production's published manifest. The new manifest
 * names each graph once; the build's own files stay unchanged, and a carried file is never a source map.
 * A kept graph that collides with a path this build writes is dropped with a warning, unless it is the build live at
 * the origin right now and that build is this repository's: open tabs on it lazy-load these chunks, so the build fails,
 * naming the file and the deploy. A live build from another repository (the singleplayer shell that J210 retires) is the
 * one this deploy replaces, so its clash is a warning.
 * @param {string} directory
 * A test build (`optional`) treats a 5xx or network failure fetching the origin's manifest as no previous builds.
 * PZ5: `contentBase` says this build reads its content from a content base: its graph names its code only and is marked,
 * and a marked kept graph carries its code only (`CHUNK`). An unmarked one keeps its content, since its tabs read the page.
 * PAGE-SIZE D1: `budget` is what the kept builds may add to the page (D1's limits less this build's own page). Newest first, a
 * kept build that would take the page past it is dropped whole, as a pruned build is: chunk recovery moves its tabs on. Without
 * it, the first build that splits its content off carried four builds that hold theirs (preview, 2026-11-13: 178 MB) and the
 * gate refused every build, so those never aged out.
 * @param {{previousDirectory?: string, previousOrigin?: string, live?: readonly string[], ours?: (build: string) => boolean, optional?: boolean, contentBase?: boolean, budget?: {files: number, bytes: number}}} [options]
 */
export async function carryPreviousDeploy(directory, options = {}) {
  const current = currentManifest(directory, options.contentBase === true);
  /** @type {readonly string[] | undefined} */
  let live = options.live;
  const ours = options.ours ?? ownBuild;
  /** @type {Graph[]} */
  let previous = [];
  if (options.previousDirectory !== undefined) {
    previous = readManifest(JSON.parse(readFileSync(join(options.previousDirectory, MANIFEST), 'utf8')));
  } else if (options.previousOrigin !== undefined) {
    // A test build may meet a paused or failing production (a host's spend cap answered 503 DEPLOYMENT_PAUSED, main ci
    // 43111080979): a 5xx or a transport failure (before or after the headers) warns and carries nothing. A release still
    // refuses, so it never ships without the kept graphs. A body that arrives but is not a valid manifest always refuses.
    /** @param {string} why */
    const unavailable = why => { console.warn(`Previous deploy manifest unavailable (${why} from ${options.previousOrigin}), so this test build carries no previous builds`); };
    /** @type {{status: number, html: boolean, body: string} | undefined} */
    let answer;
    try {
      const response = await fetch(new URL(`/${MANIFEST}`, options.previousOrigin), {cache: 'no-store', signal: AbortSignal.timeout(30000)});
      if (options.optional === true && response.status >= 500) unavailable(String(response.status));
      // The first release of this output format has no predecessor manifest.
      else if (!response.ok && response.status !== 404) throw new RefusedError(`Previous deploy manifest returned ${response.status}`);
      else answer = {status: response.status, html: response.headers.get('content-type')?.includes('text/html') === true, body: await response.text()};
    } catch (error) {
      if (options.optional !== true || error instanceof RefusedError) throw error;
      unavailable(error instanceof Error ? error.message : String(error));
    }
    if (answer !== undefined && answer.status !== 404 && !answer.html) previous = readManifest(JSON.parse(answer.body));
  }
  const held = new Map(current.files.map(row => [row.path, row.bytes])), kept = [current];
  let carried = 0, bytes = 0;
  for (const whole of previous.filter(row => row.build !== current.build).slice(0, KEEP_PROMOTED - 1)) {
    const carry = carryOf(whole.content), graph = {...whole, files: whole.files.filter(row => carry.test(row.path))};
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
    const freshBytes = fresh.reduce((sum, row) => sum + row.bytes, 0), budget = options.budget;
    if (budget !== undefined && (carried + fresh.length > budget.files || bytes + freshBytes > budget.bytes)) {
      console.warn(`Dropped previous build ${graph.build}: its ${String(fresh.length)} files (${(freshBytes / 1e6).toFixed(1)} MB) would take the page past PAGE-SIZE D1 (room for ${String(Math.max(0, budget.files - carried))} files, ${(Math.max(0, budget.bytes - bytes) / 1e6).toFixed(1)} MB)`);
      continue;
    }
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
