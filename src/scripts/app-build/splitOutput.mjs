#!/usr/bin/env node
// PAGE-SIZE PZ4 (meta docs/plans/PAGE-SIZE-PLAN.md, J276, D1 yes): the build output splits in two. The page, `dist/`,
// keeps code, shell, runtime and maps. Its content, shard content (S1 to S7) and engine art (E1), moves to
// `dist-content/` beside it at the same page paths, the tree PZ2 publishes and PZ3's `contentBase` mirrors.
// `--join` moves it back, for a host that serves one tree: until a channel stamps a `contentBase` (PZ8), page-release
// joins before it packages, and the jobs that serve the whole game from dist (nightly, hover contract) join too.
//
//   node src/scripts/app-build/splitOutput.mjs [dist] [--join]
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, writeFileSync} from 'node:fs';
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
  // a kept build's content (MF2 carry, PZ5: an unmarked build reads it from the page) stays on the page until it ages out
  const carried = carriedPaths(root)?.paths ?? new Set();
  const shards = shardNames(root), rows = files(root).filter(row => row.path !== SPLITTING && row.path !== `${SPLITTING}.tmp` && !carried.has(row.path) && isContent(row.path, shards));
  // The full desired path list makes pruning resumable too. An empty mark
  // from the previous implementation already had its old target removed.
  if (rows.length > 0 && !existsSync(mark)) {
    writeFileSync(`${mark}.tmp`, JSON.stringify(rows.map(row => row.path)));
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
  rmSync(mark, {force: true});
  rmSync(`${mark}.tmp`, {force: true});
  return moved;
}

/** Put the content back into the page, one tree again, and remove dist-content.
 * @param {string} dist @param {string} [content] @returns {{files: number, bytes: number}} */
export function joinOutput(dist, content = contentDirOf(dist)) {
  const from = resolve(content);
  disjoint(resolve(dist), from);
  const moved = move(from, resolve(dist), files(from));
  rmSync(from, {recursive: true, force: true});
  return moved;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), join_ = args.includes('--join'), dist = resolve(args.find(arg => !arg.startsWith('--')) ?? 'dist');
  const mb = (/** @type {number} */ bytes) => (bytes / 1e6).toFixed(1);
  const moved = join_ ? joinOutput(dist) : splitOutput(dist);
  console.info(join_
    ? `splitOutput: joined ${moved.files} content files (${mb(moved.bytes)} MB) from ${contentDirOf(dist)} back into ${dist}`
    : `splitOutput: moved ${moved.files} content files (${mb(moved.bytes)} MB) from ${dist} to ${contentDirOf(dist)}`);
}
