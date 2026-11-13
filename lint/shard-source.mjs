// SA45 (J317, J329): the one answer to "is this file shard source, which shard, and where is its root", for both
// layouts. Engine and multi-shard repos keep `src/shards/<slug>/`; a single-shard repo keeps its one shard at `src/`
// (`src/shard.config.ts`, or a hand-written `src/shard.json`), the rule sharddev's shardSource.ts (SA16) uses.
//
// Lint rules match one layout: a single-shard file `src/<local>` reads as `src/shards/<slug>/<local>` (its source path).
// Debt keys (lint/ratchet.json, runtime-performance.json) use that form too, so a repo's keys survive the move to `src/`.
// Anything that opens the file on disk uses its real path; scripts/blender/targets.json may name either form.
import { existsSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

const SHARD_CONFIG = 'shard.config.ts';
const SHARD_INDEX = 'shard.json';
const slash = path => path.replaceAll('\\', '/');
const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};

const repoSlugs = new Map();
/** The slug of the one shard whose source is `<repo>/src`, or null when that `src/` is no shard source. Like
 *  sharddev's shardFolderName: a hand-written source's `identity.slug`, else `manifest.json`'s `slug`, else the repo folder. */
export function repoShardSlug(repo) {
  const key = resolve(repo);
  if (repoSlugs.has(key)) return repoSlugs.get(key);
  const src = resolve(key, 'src'), config = existsSync(resolve(src, SHARD_CONFIG));
  const handwritten = !config && existsSync(resolve(src, SHARD_INDEX));
  let slug = null;
  if (config || handwritten) {
    const named = (handwritten ? readJson(resolve(src, SHARD_INDEX))?.identity?.slug : undefined) ?? readJson(resolve(src, 'manifest.json'))?.slug;
    slug = typeof named === 'string' && named !== '' ? named : basename(key);
  }
  repoSlugs.set(key, slug);
  return slug;
}

/** `file` (relative to the repo `root`, real layout) as shard source: its slug, its shard-local path, its shard root
 *  relative to `root` (`src` or `src/shards/<slug>`) and its source path (`src/shards/<slug>/<local>`); else null. */
export function shardFile(root, file) {
  const path = slash(file);
  if (!path.startsWith('src/')) return null;
  const single = repoShardSlug(root);
  if (single !== null) {
    const local = path.slice('src/'.length);
    return local === '' ? null : { slug: single, local, base: 'src', path: `src/shards/${single}/${local}` };
  }
  const match = /^src\/shards\/([^/]+)\/(.+)$/u.exec(path);
  return match === null ? null : { slug: match[1], local: match[2], base: `src/shards/${match[1]}`, path };
}

/** The folders (relative to `root`) that hold shard source: `src` in a single-shard repo, else `src/shards`. */
export function shardSourceDirs(root) {
  return repoShardSlug(root) === null ? ['src/shards'] : ['src'];
}

/** The innermost single-shard repo holding absolute `abs` (the folder above one of its `/src/` segments), or null. */
function singleRepoOf(abs) {
  const path = slash(abs);
  for (let index = path.lastIndexOf('/src/'); index > 0; index = path.lastIndexOf('/src/', index - 1)) {
    if (repoShardSlug(path.slice(0, index)) !== null) return path.slice(0, index);
  }
  return null;
}

/** Absolute `filename` as lint sees it: `file` its repo-relative real path from the last `/src/` (or relative to
 *  `base` when it has none), `path` its source path, `root` the repo root, and `shard` its shardFile (or null). */
export function lintFile(filename, base) {
  const abs = resolve(filename), repo = singleRepoOf(abs);
  if (repo !== null) {
    const file = slash(relative(repo, abs)), shard = shardFile(repo, file);
    return { root: repo.split('/').join(sep), file, path: shard?.path ?? file, shard };
  }
  const path = slash(relative(base, abs)), index = path.lastIndexOf('/src/');
  const file = index === -1 ? path : path.slice(index + 1);
  const absolute = slash(abs), marker = absolute.lastIndexOf('/src/');
  const root = marker === -1 ? resolve(base) : abs.slice(0, marker);
  const match = /^src\/shards\/([^/]+)\/(.+)$/u.exec(file);
  return { root, file, path: file, shard: match === null ? null : { slug: match[1], local: match[2], base: `src/shards/${match[1]}`, path: file } };
}

/** Absolute `filename`'s source path (see lintFile). */
export const sourcePath = (filename, base) => lintFile(filename, base).path;

/** Absolute `filename`'s shard: slug, shard-local path and the absolute shard root folder; null outside shard source. */
export function shardOfFilename(filename) {
  const abs = slash(resolve(filename)), repo = singleRepoOf(abs);
  if (repo !== null) {
    const local = abs.slice(repo.length + '/src/'.length);
    return local === '' ? null : { slug: repoShardSlug(repo), local, dir: `${repo}/src/` };
  }
  const match = /(?:^|\/)src\/shards\/([^/]+)\/(.+)$/u.exec(abs);
  return match === null ? null : { slug: match[1], local: match[2], dir: abs.slice(0, abs.length - match[2].length) };
}
