#!/usr/bin/env node
// HOW-WE-BUILD ENG-16 (meta SHARD-AUTHORING SA15, J314): engine's devserver client, the page an installed `wildshard dev`
// serves around an author's shard. sharddev can't build it (it is this repo's whole app build), so server-release.yml puts
// it on the GitHub release of every tag it publishes (`server-staging-<sha>` for green main, `vX.Y.Z`), and sharddev's
// `src/sharddev/devClient.ts` fetches it once per engine pin.
//
// The archive is `build-app.mjs --mode devserver`, minus what only a first-party page reads: the pinned shards' folders
// (their `discovery.json` stays, the title deck reads it), their asset folders and KTX2 and baked textures, spawn sets,
// programs, drafts, trailers and source maps. The author's own shard comes from `wildshard dev`'s build.
//
//   python3 scripts/heavy-lane.py build -- node scripts/devserver-client.mjs --out <devserver-client.tar.gz> [--keep <folder>]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
/** The release asset's name; sharddev's `DEV_CLIENT_ASSET` reads the same. */
export const DEV_CLIENT_ASSET = 'devserver-client.tar.gz';
/** Top-level paths (and `assets/` folders) a devserver page never reads. */
const DROP_TOP = ['programs', 'drafts', 'trailer-15.mp4', 'trailer-30.mp4'];
const DROP_ASSETS = ['driftwood-isle', 'far-reach', 'nalati', 'nine-dragon', 'pine-hollow', 'sunscar-dunes', 'practice'];
/** `assets/gpu/` (KTX2 stand-ins): the shards' own folders go; the engine's `tex`, `models` and `horizon` stay. */
const DROP_GPU = ['baked', 'far-reach', 'nalati', 'nine-dragon', 'pine-hollow'];

/** Prune a devserver build in place to the client an author's page reads. @param {string} client */
export function pruneDevserverClient(client) {
  const flags = JSON.parse(readFileSync(join(client, 'build-flags.json'), 'utf8'));
  if (flags?.devserver !== true) throw new Error('devserver-client: the build is not in devserver mode');
  for (const name of DROP_TOP) rmSync(join(client, name), { recursive: true, force: true });
  for (const name of DROP_ASSETS) rmSync(join(client, 'assets', name), { recursive: true, force: true });
  for (const name of DROP_GPU) rmSync(join(client, 'assets', 'gpu', name), { recursive: true, force: true });
  // baked: only the engine's common bake; spawn: only the in-page server's book (`server-<build>.json`)
  for (const [folder, keep] of /** @type {const} */ ([['assets/baked', name => name === 'common'], ['assets/spawn', name => /^server-.+\.json$/u.test(name)]])) {
    const path = join(client, folder);
    if (existsSync(path)) for (const name of readdirSync(path)) if (!keep(name)) rmSync(join(path, name), { recursive: true, force: true });
  }
  const shardfiles = join(client, 'shardfiles');
  if (existsSync(shardfiles)) for (const slug of readdirSync(shardfiles)) {
    for (const name of readdirSync(join(shardfiles, slug))) if (name !== 'discovery.json') rmSync(join(shardfiles, slug, name), { recursive: true, force: true });
  }
  for (const entry of readdirSync(client, { recursive: true, withFileTypes: true })) if (entry.isFile() && entry.name.endsWith('.map')) rmSync(join(entry.parentPath, entry.name));
}

/** @param {string} folder @returns {number} */
const bytesOf = folder => readdirSync(folder, { recursive: true, withFileTypes: true }).reduce((sum, entry) => sum + (entry.isFile() ? statSync(join(entry.parentPath, entry.name)).size : 0), 0);

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), option = (/** @type {string} */ name) => { const at = args.indexOf(`--${name}`); return at === -1 ? undefined : args[at + 1]; };
  const out = resolve(option('out') ?? join('tmp', 'devserver-client', DEV_CLIENT_ASSET));
  const client = resolve(option('keep') ?? join(ROOT, 'tmp', 'devserver-client', 'client'));
  if (relative(ROOT, client).startsWith('..')) throw new Error('devserver-client: the build folder must be inside this checkout (build-app defers its public copy there)');
  rmSync(client, { recursive: true, force: true });
  const built = spawnSync(process.execPath, ['scripts/build-app.mjs', '--mode', 'devserver', '--outDir', client], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, WILDSHARD_CATALOGUE: process.env.WILDSHARD_CATALOGUE ?? 'test/pins/catalogue.json' } });
  if (built.status !== 0) throw new Error(`devserver-client: build-app exited ${String(built.status)}`);
  const before = bytesOf(client);
  pruneDevserverClient(client);
  mkdirSync(resolve(out, '..'), { recursive: true });
  // the same bytes for the same tree: sorted names, no owners or times (as the dedicated bundle is packed in server-release.yml)
  const tar = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout.includes('GNU') ? 'tar' : 'gtar';
  const gnu = spawnSync(tar, ['--version'], { encoding: 'utf8' }).status === 0;
  execFileSync('bash', ['-c', gnu
    ? `set -euo pipefail; ${tar} --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner -cf - -C "$1" . | gzip -n > "$2"`
    : 'set -euo pipefail; tar -cf - -C "$1" . | gzip -n > "$2"', 'pack', client, out], { stdio: 'inherit' });
  console.log(`devserver-client: ${(before / 1e6).toFixed(0)} MB built, ${(bytesOf(client) / 1e6).toFixed(0)} MB kept, ${(statSync(out).size / 1e6).toFixed(1)} MB packed: ${out}`);
  if (option('keep') === undefined) rmSync(client, { recursive: true, force: true });
}
