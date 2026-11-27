#!/usr/bin/env node
// PAGE-SIZE PZ4 (meta docs/plans/PAGE-SIZE-PLAN.md, J276, D1 yes): the build output splits in two. The page, `dist/`,
// keeps code, shell, runtime and maps. Its content, shard content (S1 to S7) and engine art (E1), moves to
// `dist-content/` beside it at the same page paths, the tree PZ2 publishes and PZ3's `contentBase` mirrors.
// `--join` moves it back, for a host that serves one tree: until a channel stamps a `contentBase` (PZ8), page-release
// joins before it packages, and the jobs that serve the whole game from dist (nightly, hover contract) join too.
//
// Fix preview PV17: the strict join for staging and production allows engine art and build-owned world files.
// Zone payloads still come from the cook (PV16).
//
//   node src/scripts/app-build/splitOutput.mjs [dist] [--join [--no-shard-content]]
import {constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {carriedPaths, classify, shardNames} from '../page-size.mjs';

/** The content tree beside a page: `dist` → `dist-content`. @param {string} dist */
export const contentDirOf = dist => `${resolve(dist)}-content`;

/** A page path is content when it is shard content or engine art (D1 yes).
 * @param {string} path @param {ReadonlySet<string>} shards */
export function isContent(path, shards) {
  const {kind} = classify(path, shards);
  return kind === 'shard content' || kind === 'engine art';
}

/** Every file (or link) under a root, never following a link. @param {string} root @returns {{path: string, bytes: number}[]} */
function files(root) {
  /** @type {{path: string, bytes: number}[]} */ const rows = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name), info = lstatSync(at), path = prefix === '' ? name : `${prefix}/${name}`;
      if (info.isDirectory()) walk(at, path);
      else rows.push({path, bytes: info.size});
    }
  };
  if (existsSync(root)) walk(root, '');
  return rows;
}

/** Move each path from one root to the other, then drop the folders the moves emptied.
 * @param {string} from @param {string} to @param {readonly {path: string, bytes: number}[]} rows */
function move(from, to, rows, reuse = false) {
  for (const {path} of rows) {
    const source = join(from, path), target = join(to, path);
    let old;
    try { old = lstatSync(target); } catch { /* A new generated path. */ }
    if (old) {
      if (!reuse) throw new Error(`splitOutput: ${target} already exists`);
      const next = lstatSync(source);
      const same = old.isFile() && next.isFile() && old.size === next.size && readFileSync(target).equals(readFileSync(source))
        || old.isSymbolicLink() && next.isSymbolicLink() && readlinkSync(target) === readlinkSync(source);
      if (same) { rmSync(source); continue; }
      rmSync(target, {recursive: true, force: true});
    }
    mkdirSync(dirname(target), {recursive: true});
    renameSync(source, target);
  }
  const folders = new Set(rows.flatMap(({path}) => path.split('/').slice(0, -1).map((_, at, parts) => parts.slice(0, at + 1).join('/'))));
  for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
    const at = join(from, folder);
    if (existsSync(at) && readdirSync(at).length === 0) rmdirSync(at);
  }
  return {files: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0)};
}

/** The page's mark while a split runs: a retry after an interruption resumes, keeping what already moved. */
export const SPLITTING = '.splitting';

/** @param {string} root @param {string} content */
function disjoint(root, content) {
  if (root === content || content.startsWith(`${root}/`) || root.startsWith(`${content}/`)) throw new Error(`splitOutput: ${content} and ${root} overlap`);
}

/** Split a freshly built page. Unchanged content retains its inode/APFS blocks; stale paths are replaced. An interrupted split
 * left (the page still holds SPLITTING) is kept and finished. A page that holds no content is already split.
 * @param {string} dist @param {string} [content] @returns {{files: number, bytes: number}} */
export function splitOutput(dist, content = contentDirOf(dist)) {
  const root = resolve(dist), target = resolve(content), mark = join(root, SPLITTING);
  disjoint(root, target);
  try {
    if (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) throw new Error('splitOutput: content root must be a real directory');
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (!existsSync(join(root, 'index.html'))) throw new Error(`splitOutput: ${root} holds no index.html; give a built page`);
  // a kept build's content (MF2 carry, PZ5: an unmarked build reads it from the page) stays on the page until it ages out.
  // It goes to the set as well: a build that publishes its content names only its code in deploy-chunks.json, so a content
  // path this build still uses looks carried whenever a kept unmarked build listed it too. v0.1.92 kept 357 such paths
  // (boot tables, grid seams and strips, title art) on the page only, and its client, sent to the set, met 404s (QA 11-25
  // row 121, P0).
  const carried = carriedPaths(root)?.paths ?? new Set();
  const shards = shardNames(root), found = files(root).filter(row => row.path !== SPLITTING && row.path !== `${SPLITTING}.tmp` && isContent(row.path, shards));
  const rows = found.filter(row => !carried.has(row.path)), kept = found.filter(row => carried.has(row.path));
  // The full desired path list makes pruning resumable too. An empty mark
  // from the previous implementation already had its old target removed.
  if (found.length > 0 && !existsSync(mark)) {
    writeFileSync(`${mark}.tmp`, JSON.stringify(found.map(row => row.path)));
    renameSync(`${mark}.tmp`, mark);
  }
  if (existsSync(mark) && readFileSync(mark, 'utf8') !== '') {
    let paths;
    try { paths = JSON.parse(readFileSync(mark, 'utf8')); } catch { throw new Error('splitOutput: invalid interrupted path list; inspect output and remove .splitting to restart'); }
    if (!Array.isArray(paths) || !paths.every(path => typeof path === 'string')) throw new Error('splitOutput: invalid interrupted path list; inspect output and remove .splitting to restart');
    const desired = new Set(paths);
    for (const {path} of files(target)) if (!desired.has(path)) rmSync(join(target, path));
  }
  const moved = move(root, target, rows, true);
  for (const {path} of kept) {
    const source = join(root, path), copy = join(target, path);
    if (existsSync(copy) && lstatSync(copy).isFile() && readFileSync(copy).equals(readFileSync(source))) continue;
    rmSync(copy, {recursive: true, force: true});
    mkdirSync(dirname(copy), {recursive: true});
    copyFileSync(source, copy, constants.COPYFILE_FICLONE);
  }
  rmSync(mark, {force: true});
  rmSync(`${mark}.tmp`, {force: true});
  return moved;
}

/** The content paths a split page still holds that its set's index lacks. The stamped page sends its client to the set
 * for every content path, so each one must be there (QA 11-25 row 121, P0: v0.1.92's set lacked 357).
 * @param {string} dist @param {ReadonlySet<string>} held the set index's paths @returns {string[]} */
export function contentGaps(dist, held) {
  const root = resolve(dist), shards = shardNames(root);
  return files(root).filter(row => row.path !== SPLITTING && isContent(row.path, shards) && !held.has(row.path)).map(row => row.path).sort();
}

// The size report groups world files with shard content because both used to go in the content set (PZ4).
// These files describe the whole build or the engine's own spawn downloads, even on a page with no zones baked in.
const BUILD_WORLD_PATHS = [
  /^assets\/(?:boot-tables|grid-seams|grid-seam-plans|grid-strip-(?:book|page))-[a-f0-9]{8}\.json$/u,
  /^assets\/grid-strip-mesh-[a-f0-9]{8}\.bin$/u,
  /^assets\/world-map-[a-f0-9]{16}\.webp$/u,
  /^assets\/spawn\/engine-(?:[a-f0-9]{40}|(?:client|grid)-(?:phone|desktop)-[a-f0-9]{16})\.json$/u,
];
const SERVER_BOOK = /^assets\/spawn\/server-([a-f0-9]{40})\.json$/u;
const ROAD_PART = /^\/assets\/spawn\/server\/[a-f0-9]{16}\.pack\.br$/u;

/** A zone-free server book may still name the build's road. Only its grid part is eligible for the strict join.
 * @param {string} root @param {readonly {path: string}[]} rows */
function gridServerPaths(root, rows) {
  /** @type {Set<string>} */
  const paths = new Set();
  for (const {path} of rows) {
    const match = SERVER_BOOK.exec(path);
    if (match === null) continue;
    try {
      /** @type {{book?: string, build?: string, shards?: object, grid?: {url?: string, files?: readonly unknown[]}} | null} */
      const book = JSON.parse(readFileSync(join(root, path), 'utf8'));
      const {shards, grid} = book ?? {};
      if (book?.book !== 'server' || book.build !== match[1] || typeof shards !== 'object' || shards === null ||
          Array.isArray(shards) || Object.keys(shards).length !== 0) continue;
      if (grid !== undefined) {
        if (typeof grid?.url !== 'string' || !ROAD_PART.test(grid.url) || !Array.isArray(grid.files) ||
            !grid.files.every(row => Array.isArray(row) && typeof row[0] === 'string' && row[0].startsWith('grid/'))) continue;
        paths.add(grid.url.slice(1));
      }
      paths.add(path);
    } catch { /* The strict join refuses an unreadable book. */ }
  }
  return paths;
}

/** PV17: the zone payloads a content tree holds. Staging and production join their build-owned files with engine art.
 * @param {string} dist @param {string} [content] @returns {string[]} */
export function shardContent(dist, content = contentDirOf(dist)) {
  const from = resolve(content), shards = new Set([...shardNames(resolve(dist)), ...shardNames(from)]);
  const rows = files(from), grid = gridServerPaths(from, rows);
  return rows.map(row => row.path).filter(path => classify(path, shards).kind === 'shard content' &&
    !grid.has(path) && !BUILD_WORLD_PATHS.some(pattern => pattern.test(path))).sort();
}

/** Put the content back into the page, one tree again, and remove dist-content.
 * @param {string} dist @param {string} [content] @returns {{files: number, bytes: number}} */
export function joinOutput(dist, content = contentDirOf(dist)) {
  const from = resolve(content);
  disjoint(resolve(dist), from);
  // A kept build's content is on both sides (splitOutput copies it to the set too); the same bytes join as one file.
  const moved = move(from, resolve(dist), files(from), true);
  rmSync(from, {recursive: true, force: true});
  return moved;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), join_ = args.includes('--join'), dist = resolve(args.find(arg => !arg.startsWith('--')) ?? 'dist');
  const zones = join_ && args.includes('--no-shard-content') ? shardContent(dist) : [];
  if (zones.length > 0) {
    console.error(`splitOutput: ${contentDirOf(dist)} holds ${zones.length} shard content files (${zones.slice(0, 3).join(', ')}): this channel's zones come from the cook, not the page (fix preview PV16, PV17)`);
    process.exit(1);
  }
  const mb = (/** @type {number} */ bytes) => (bytes / 1e6).toFixed(1);
  const moved = join_ ? joinOutput(dist) : splitOutput(dist);
  console.info(join_
    ? `splitOutput: joined ${moved.files} content files (${mb(moved.bytes)} MB) from ${contentDirOf(dist)} back into ${dist}`
    : `splitOutput: moved ${moved.files} content files (${mb(moved.bytes)} MB) from ${dist} to ${contentDirOf(dist)}`);
}
