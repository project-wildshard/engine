#!/usr/bin/env node
// HOW-WE-BUILD ENG-16 (meta SHARD-AUTHORING SA15, J314): engine's devserver client, the page an installed `wildshard dev`
// serves around an author's shard. sharddev can't build it (it is this repo's whole app build), so server-release.yml puts
// it on the GitHub release of every tag it publishes (`server-staging-<sha>` for green main, `vX.Y.Z`), and sharddev's
// `src/sharddev/devClient.ts` fetches it once per engine pin.
//
// The archive is `build-app.mjs --mode devserver`, minus what only a first-party page reads: the pinned shards' folders
// (their `discovery.json` stays, the title deck reads it, and so does the card art it names under `art`), their asset
// folders and KTX2 and baked textures, spawn sets, programs, drafts and source maps. The author's own shard comes
// from `wildshard dev`'s build. TC13 (mini QA, 2026-11-16): v0.1.29's archive kept the discovery files but not their art,
// so every card image 404ed in a fresh SDK project; a named art file the archive lacks now refuses the archive.
//
//   python3 src/scripts/heavy-lane.py build -- node src/scripts/devserver-client.mjs --out <devserver-client.tar.gz> [--keep <folder>]
//
// SHARD-AUTHORING SA43: `--kind preparation` packs the client `wildshard prepare` records in, `preparation-client.tar.gz`:
// the production build (DEVSERVER off, the production renderer and its revision) made with `WILDSHARD_PREPARATION_ONLY=1`,
// so it owns the author's inline draft as `wildshard dev`'s page does, pruned the same way. check-devserver refuses to
// release it; it is only ever a release asset beside the devserver client.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
/** The release asset's name; sharddev's `DEV_CLIENT_ASSET` reads the same. */
export const DEV_CLIENT_ASSET = 'devserver-client.tar.gz';
/** SA43: the preparation client's asset; sharddev's `PREPARATION_CLIENT_ASSET` reads the same. */
export const PREPARATION_CLIENT_ASSET = 'preparation-client.tar.gz';
/** @typedef {'devserver' | 'preparation'} ClientKind */
/** Top-level paths (and `assets/` folders) a devserver page never reads. */
const DROP_TOP = ['programs', 'drafts'];
const DROP_ASSETS = ['driftwood-isle', 'far-reach', 'nalati', 'nine-dragon', 'pine-hollow', 'sunscar-dunes', 'practice'];
/** `assets/gpu/` (KTX2 stand-ins): the shards' own folders go; the engine's `tex`, `models` and `horizon` stay. */
const DROP_GPU = ['baked', 'far-reach', 'nalati', 'nine-dragon', 'pine-hollow'];

/** TC13: the card art each `shardfiles/<slug>/discovery.json` names (`art`: URL -> bytes), as client-relative paths.
 *  @param {string} client @returns {Set<string>} */
export function discoveryArt(client) {
  const shardfiles = join(client, 'shardfiles'), art = new Set();
  if (!existsSync(shardfiles)) return art;
  for (const slug of readdirSync(shardfiles)) {
    const file = join(shardfiles, slug, 'discovery.json');
    if (!existsSync(file)) continue;
    const named = JSON.parse(readFileSync(file, 'utf8'))?.art;
    if (named === undefined || named === null) continue;
    if (typeof named !== 'object') throw new Error(`devserver-client: ${slug}'s discovery.json has an art that is not a map`);
    for (const url of Object.keys(named)) {
      const path = url.replace(/^\//u, '');
      if (path.split('/').includes('..') || path === '') throw new Error(`devserver-client: ${slug}'s discovery.json names art outside the client: ${url}`);
      art.add(path);
    }
  }
  return art;
}

/** FORMAT-PRUNE FP55: drop each KTX2 table row (`native.ktx2`, page-mode tables or a plain `GPU_FILES`) whose file the prune
 *  removed from the client. A pinned shard's cooked splat layers (`/shardfiles/<slug>/blobs/ktx2/<hash>.ktx2#layer` to
 *  `/assets/<slug>/splat/...`) were kept by their discovery document while their folder went, so an author's candidate with
 *  the same splat blobs read the missing files and 404ed at level.world; without the row the page reads its own blob.
 *  @param {string} client @returns {number} rows dropped */
export function dropDanglingKtx2Rows(client) {
  const shardfiles = join(client, 'shardfiles');
  if (!existsSync(shardfiles)) return 0;
  let dropped = 0;
  /** @param {unknown} row */
  const isRow = row => typeof row === 'object' && row !== null && !Array.isArray(row);
  /** @param {Record<string, unknown>} table @returns {boolean} */
  const prune = table => {
    let changed = false;
    for (const [key, url] of Object.entries(table)) {
      if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) continue;
      const path = url.replace(/^\//u, '').replace(/[?#].*$/u, '');
      if (path.split('/').includes('..') || existsSync(join(client, path))) continue;
      delete table[key]; dropped++; changed = true;
    }
    return changed;
  };
  for (const slug of readdirSync(shardfiles)) {
    const file = join(shardfiles, slug, 'discovery.json');
    if (!existsSync(file)) continue;
    const document = JSON.parse(readFileSync(file, 'utf8')), ktx2 = isRow(document) && isRow(document.native) ? document.native.ktx2 : undefined;
    if (!isRow(ktx2)) continue;
    /** @type {Record<string, unknown>[]} */
    const tables = [];
    const modes = ktx2.$call === 'pageModeKtx2' && Array.isArray(ktx2.args) && isRow(ktx2.args[0]) ? Object.values(ktx2.args[0]) : !('$call' in ktx2) ? [ktx2.GPU_FILES] : [];
    for (const mode of modes) if (isRow(mode)) for (const tier of ['phone', 'desktop']) if (isRow(mode[tier])) tables.push(mode[tier]);
    let changed = false;
    for (const table of tables) changed = prune(table) || changed;
    if (changed) writeFileSync(file, JSON.stringify(document));
  }
  return dropped;
}

/** Prune a devserver build (or, SA43, a preparation-only production build) in place to the client an author's page reads.
 *  @param {string} client @param {ClientKind} [kind] */
export function pruneDevserverClient(client, kind = 'devserver') {
  const flags = JSON.parse(readFileSync(join(client, 'build-flags.json'), 'utf8'));
  if (kind === 'devserver' && flags?.devserver !== true) throw new Error('devserver-client: the build is not in devserver mode');
  if (kind === 'preparation') {
    const versionFile = join(client, 'version.json');
    const version = existsSync(versionFile) ? JSON.parse(readFileSync(versionFile, 'utf8')) : undefined;
    if (flags?.devserver !== false || version?.preparationOnly !== true) throw new Error('devserver-client: the build is not a preparation-only production build');
  }
  const art = discoveryArt(client), kept = (/** @type {string} */ file) => art.has(relative(client, file).split(sep).join('/'));
  /** Everything under `path` but the art a discovery file names. @param {string} path */
  const drop = path => {
    if (!existsSync(path)) return;
    if (!statSync(path).isDirectory()) { if (!kept(path)) rmSync(path, { force: true }); return; }
    for (const entry of readdirSync(path)) drop(join(path, entry));
    if (readdirSync(path).length === 0) rmSync(path, { recursive: true, force: true });
  };
  for (const name of DROP_TOP) drop(join(client, name));
  for (const name of DROP_ASSETS) drop(join(client, 'assets', name));
  for (const name of DROP_GPU) drop(join(client, 'assets', 'gpu', name));
  // baked: only the engine's common bake; spawn: only the in-page server's book (`server-<build>.json`)
  for (const [folder, keep] of /** @type {const} */ ([['assets/baked', name => name === 'common'], ['assets/spawn', name => /^server-.+\.json$/u.test(name)]])) {
    const path = join(client, folder);
    if (existsSync(path)) for (const name of readdirSync(path)) if (!keep(name)) drop(join(path, name));
  }
  const shardfiles = join(client, 'shardfiles');
  if (existsSync(shardfiles)) for (const slug of readdirSync(shardfiles)) {
    for (const name of readdirSync(join(shardfiles, slug))) if (name !== 'discovery.json') drop(join(shardfiles, slug, name));
  }
  for (const entry of readdirSync(client, { recursive: true, withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.map')) rmSync(join(entry.parentPath, entry.name));
  dropDanglingKtx2Rows(client);
  // A card image the page will ask for and the archive lacks is a 404 in every author's project: refuse to pack it.
  const missing = [...art].filter(path => !existsSync(join(client, path))).sort();
  if (missing.length > 0) throw new Error(`devserver-client: ${missing.length} discovery art file(s) the build lacks: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
}

/** @param {string} folder @returns {number} */
const bytesOf = folder => readdirSync(folder, { recursive: true, withFileTypes: true }).reduce((sum, entry) => sum + (entry.isFile() ? statSync(join(entry.parentPath, entry.name)).size : 0), 0);

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (/** @type {string} */ name) => { const at = args.indexOf(`--${name}`); return at === -1 ? undefined : args[at + 1]; };
  const kind = /** @type {ClientKind} */ (option('kind') ?? 'devserver');
  if (kind !== 'devserver' && kind !== 'preparation') throw new Error(`devserver-client: --kind is devserver or preparation, not ${String(kind)}`);
  const out = resolve(option('out') ?? join('tmp', 'devserver-client', kind === 'devserver' ? DEV_CLIENT_ASSET : PREPARATION_CLIENT_ASSET));
  const client = resolve(option('keep') ?? join(ROOT, 'tmp', 'devserver-client', 'client'));
  if (relative(ROOT, client).startsWith('..')) throw new Error('devserver-client: the build folder must be inside this checkout (build-app defers its public copy there)');
  rmSync(client, { recursive: true, force: true });
  const built = spawnSync(process.execPath, ['src/scripts/build-app.mjs', '--mode', kind === 'devserver' ? 'devserver' : 'preview', '--outDir', client], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, WILDSHARD_CATALOGUE: process.env.WILDSHARD_CATALOGUE ?? 'test/pins/catalogue.json',
      ...(kind === 'preparation' ? { WILDSHARD_PREPARATION_ONLY: '1' } : {}) } });
  if (built.status !== 0) throw new Error(`devserver-client: build-app exited ${String(built.status)}`);
  const before = bytesOf(client);
  pruneDevserverClient(client, kind);
  mkdirSync(resolve(out, '..'), { recursive: true });
  // the same bytes for the same tree: sorted names, no owners or times (as the dedicated bundle is packed in server-release.yml)
  const tar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout.includes('GNU') ? 'tar' : 'gtar';
  const gnu = spawnSync(tar, ['--version'], { encoding: 'utf8' }).status === 0;
  execFileSync('bash', ['-c', gnu
    ? `set -euo pipefail; ${tar} --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -cf - -C "$1" . | gzip -n > "$2"`
    : 'set -euo pipefail; tar -cf - -C "$1" . | gzip -n > "$2"', 'pack', client, out], { stdio: 'inherit' });
  console.log(`devserver-client (${kind}): ${(before / 1e6).toFixed(0)} MB built, ${(bytesOf(client) / 1e6).toFixed(0)} MB kept, ${(statSync(out).size / 1e6).toFixed(1)} MB packed: ${out}`);
  if (option('keep') === undefined) rmSync(client, { recursive: true, force: true });
}
