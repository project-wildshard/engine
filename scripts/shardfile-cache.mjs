// Fast proofs (Jake 2026-10-15, "make each proof quick and cheap"): a shardfile product is rebuilt only when a file it
// can read changed. Opt-in (`build-shardfiles.mjs --reuse`, used by serve-build.sh and `pnpm build:proof`); the push gate,
// CI and Vercel run the plain `pnpm build`, which rebuilds every shard before warming this cache.
//
// The default compiler records its actual Node reads and native Vite inputs in
// shardfile-inputs.mjs. This module stores immutable products and accepts the
// completed cold-build key. A fresh gate still compiles every product, warming
// the same cache without trusting a prior result.
//
// treeHashes/shardfileKey remain the conservative fallback for injected builders
// that cannot supply a compiler receipt: other shards, outputs and unread repo
// areas are excluded, while generated source bytes remain conservative inputs.
// Products are shared across mirror slots in ~/.cache/wildshard/shardfiles.
import { createHash, randomBytes } from 'node:crypto';
import { constants, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { WORKTREES } from './worktree-ignore.mjs';

const KEY_VERSION = 'shardfile-key/2';
export const KEY_FILE = '.build-key';
/** Cache metadata stays in the exempt validation receipt of a format-2 product. */
export function readBuildKey(directory) {
  try { return readFileSync(join(directory,KEY_FILE),'utf8').trim(); } catch { /* Format-2 products keep this in their receipt. */ }
  try { const key=JSON.parse(readFileSync(join(directory,'validation.json'),'utf8')).buildKey;return typeof key==='string'?key:''; } catch { return ''; }
}
const ENTRY = /^[a-f0-9]{64}$/u;
// Top-level entries no shardfile build reads (outputs, docs, native shells, side sites, local caches, plan worktrees: DS11).
const SKIP_TOP = new Set(['.git', WORKTREES, '.github', '.githooks', '.claude', '.cache', '.review', '.vercel', '.native-build', '.tsc-layers',
  'node_modules', 'tmp', 'out', 'dist', 'dist-native', 'dist-drafts', 'dist-admin', 'coverage',
  'art', 'progress', 'sources', 'docs', 'admin', 'drafts', 'ios', 'android', 'api', 'deploy', 'project', 'calibration']);
const SKIP_ANYWHERE = new Set(['node_modules', '.git', '.wildshard', '.DS_Store']);
// Outputs and derived docs inside included folders: products, legacy boot packs, the API surface and the scripts index (full `pnpm gen` only, so they differ by slot history).
const SKIP_PATHS = new Set(['public/shardfiles', 'public/assets/packs', 'lint/api-surface.json', 'scripts/README.md']);
// A shard's art/: mockup rounds and look-tool data, what top-level art/ held before S2 (lint/shard-layout.json).
const SHARD_ART = /^src\/shards\/[^/]+\/art$/u;

export function shardfileCacheRoot(env = process.env) {
  return resolve(env.WILDSHARD_SHARDFILE_CACHE ?? join(homedir(), '.cache/wildshard/shardfiles'));
}

/** Every candidate input file under root with its content hash (stat-memoized). @param {string} root */
export function treeHashes(root) {
  const memoPath = join(root, '.cache', 'shardfile-hashes.json');
  /** @type {Record<string,[number,number,number,string]>} */
  let memo = {};
  try { memo = JSON.parse(readFileSync(memoPath, 'utf8')); } catch { /* first run */ }
  /** @type {Record<string,[number,number,number,string]>} */
  const next = {};
  /** @type {Map<string,string>} */
  const files = new Map();
  /** @param {string} rel @param {boolean} top */
  const walk = (rel, top) => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      if (SKIP_ANYWHERE.has(name) || (top && SKIP_TOP.has(name))) continue;
      const path = rel === '' ? name : `${rel}/${name}`;
      if (path === 'test') { if (existsSync(join(root, 'test/fixtures'))) walk('test/fixtures', false); continue; }
      if (SKIP_PATHS.has(path) || SHARD_ART.test(path)) continue;
      const stat = lstatSync(join(root, path));
      if (stat.isDirectory()) walk(path, false);
      else if (stat.isSymbolicLink()) files.set(path, `link:${readlinkSync(join(root, path))}`);
      else if (stat.isFile()) {
        const seen = Object.hasOwn(memo, path) ? memo[path] : undefined;
        const digest = seen !== undefined && seen[0] === stat.size && seen[1] === stat.mtimeMs && seen[2] === stat.ino ? seen[3]
          : createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
        next[path] = [stat.size, stat.mtimeMs, stat.ino, digest];
        files.set(path, digest);
      }
    }
  };
  walk('', true);
  // pnpm writes this on every install; with the lockfile it pins what node_modules holds.
  for (const extra of ['node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']) {
    if (existsSync(join(root, extra))) files.set(extra, createHash('sha256').update(readFileSync(join(root, extra))).digest('hex'));
  }
  try { mkdirSync(join(root, '.cache'), { recursive: true }); writeFileSync(memoPath, JSON.stringify(next)); } catch { /* memo is an optimization */ }
  return files;
}

/** Does `path` belong to one of `others` (first-party shards other than the one keyed)? @param {string} path @param {Set<string>} others */
function belongsElsewhere(path, others) {
  const parts = path.split('/');
  if (parts[0] === 'src' && parts[1] === 'shards' && parts.length > 3) return others.has(parts[2] ?? '');
  if (parts[0] !== 'public') return false;
  return parts.slice(1, -1).some(part => others.has(part));
}

/** The content key of one shard's product. @param {Map<string,string>} files @param {string} slug @param {string[]} built
 * @param {string[]} args the build flags, root-relative */
export function shardfileKey(files, slug, built, args) {
  const others = new Set(built.filter(other => other !== slug));
  const hash = createHash('sha256').update(`${KEY_VERSION}\0${process.version}\0${slug}\0${args.join('\0')}\0`);
  for (const [path, digest] of files) if (!belongsElsewhere(path, others)) hash.update(`${path}\0${digest}\0`);
  return hash.digest('hex');
}

/** Publish complete generated bytes; no reader observes a partially copied directory.
 * @param {string} from @param {string} to */
export function publishProduct(from, to) {
  mkdirSync(dirname(to),{recursive:true});
  const temporary=join(dirname(to),`.publish-${basename(to)}-${randomBytes(5).toString('hex')}`),previous=`${temporary}-old`;
  try {
    cpSync(from,temporary,{recursive:true,mode:constants.COPYFILE_FICLONE});
    let index;
    try{index=JSON.parse(readFileSync(join(temporary,'shard.json'),'utf8'));}catch{ /* Legacy cache fixtures may contain plain text. */ }
    if(index?.format==='wildshard.shardfile'&&index.formatVersion===2&&existsSync(join(temporary,KEY_FILE))){
      const key=readFileSync(join(temporary,KEY_FILE),'utf8').trim(),receipt=JSON.parse(readFileSync(join(temporary,'validation.json'),'utf8'));
      const ordered=Object.fromEntries(Object.entries({...receipt,buildKey:key}).sort(([a],[b])=>a.localeCompare(b)));
      writeFileSync(join(temporary,'validation.json'),`${JSON.stringify(ordered)}\n`);rmSync(join(temporary,KEY_FILE));
    }
    if(existsSync(to))renameSync(to,previous);
    try{renameSync(temporary,to);}catch(error){if(existsSync(previous))renameSync(previous,to);throw error;}
  } finally {
    // Bound retries for transient ENOTEMPTY/EBUSY during publication cleanup.
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    rmSync(previous, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** A complete cache entry for this key, or undefined. @param {string} cacheRoot @param {string} slug @param {string} key */
function entryFor(cacheRoot, slug, key) {
  const entry = join(cacheRoot, slug, key);
  if (existsSync(`${entry}.lock`)) return undefined;
  try { if (readFileSync(join(entry, KEY_FILE), 'utf8').trim() === key) return entry; } catch { /* missing or partial */ }
  return undefined;
}

/** @param {number} pid */
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return !(error instanceof Error && 'code' in error && error.code === 'ESRCH'); }
}
/** Pin before looking up an entry, so eviction cannot race a product clone.
 * @param {string} entry */
export function borrowShardfileEntry(entry, untilExit = false) {
  const readers = `${entry}.readers`, owner = join(readers, `${process.pid}-${untilExit ? '0'.repeat(24) : randomBytes(12).toString('hex')}`);
  for (;;) {
    mkdirSync(readers, { recursive: true });
    try { writeFileSync(owner, '', { flag: untilExit ? 'w' : 'wx' }); break; }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
  }
  return () => {
    rmSync(owner, { force: true });
    try { rmdirSync(readers); } catch { /* Another original reader still owns it. */ }
  };
}
/** @param {string} entry */
function liveReaders(entry) {
  const readers = `${entry}.readers`;
  if (!existsSync(readers)) return false;
  let live = false;
  for (const name of readdirSync(readers)) {
    const match = /^(\d+)-[a-f0-9]{24}$/u.exec(name);
    if (match === null || alive(Number(match[1]))) live = true;
    else rmSync(join(readers, name), { force: true });
  }
  return live;
}
/** Allocated bytes without following links. @param {string} path @returns {number} */
function diskBytes(path) {
  try {
    const stat = lstatSync(path);
    return stat.blocks * 512 + (stat.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + diskBytes(join(path, name)), 0) : 0);
  } catch { return 0; /* A sibling removed it while counting. */ }
}
/** Prune idle entries, then LRU across every shard. Active clones and producers
 * survive; publication stages are never mistaken for complete products.
 * @param {string} cacheRoot
 * @param {{capBytes?:number,maxAgeMs?:number,dryRun?:boolean}} [options] */
export function pruneShardfileCache(cacheRoot, options = {}) {
  const capBytes = options.capBytes ?? 4 * 1024 ** 3, maxAgeMs = options.maxAgeMs ?? 86_400_000;
  const report = { deleted: 0, freedBytes: 0, keptBytes: 0, locked: 0 };
  if (!existsSync(cacheRoot) || !lstatSync(cacheRoot).isDirectory()) return report;
  const directories = readdirSync(cacheRoot, { withFileTypes: true }).filter(row => row.isDirectory() && !row.name.startsWith('.')).map(row => join(cacheRoot, row.name));
  const inputRoot = join(cacheRoot, '.inputs-v2');
  if (existsSync(inputRoot) && lstatSync(inputRoot).isDirectory()) {
    for (const row of readdirSync(inputRoot, { withFileTypes: true })) if (row.isDirectory()) directories.push(join(inputRoot, row.name));
  }
  // Receipt histories and ancillary metadata count toward the same budget.
  // Unknown paths/stages remain intact and consume available capacity.
  const allocated = diskBytes(cacheRoot);
  const entries = directories.flatMap(directory =>
    readdirSync(directory, { withFileTypes: true }).filter(child => child.isDirectory() && ENTRY.test(child.name)).flatMap(child => {
      const path = join(directory, child.name);
      try { return [{ path, at: statSync(path).mtimeMs, bytes: diskBytes(path) }]; } catch { return []; }
    })).sort((a, b) => a.at - b.at);
  let total = allocated;
  for (const row of entries) {
    if (Date.now() - row.at <= maxAgeMs && total <= capBytes) continue;
    const lock = `${row.path}.lock`;
    if (!options.dryRun && existsSync(lock)) {
      const owners = readdirSync(lock);
      if (owners.length === 1 && /^\d+$/u.test(owners[0] ?? '') && !alive(Number(owners[0]))) rmSync(lock, { recursive: true });
    }
    if (existsSync(lock) || liveReaders(row.path)) { report.locked++; continue; }
    if (!options.dryRun) {
      try { mkdirSync(lock); } catch { report.locked++; continue; }
      const doomed = join(dirname(row.path), `.evicting-${basename(row.path)}-${process.pid}`);
      try {
        writeFileSync(join(lock, String(process.pid)), '');
        // Readers pin first, then inspect this lock before using the entry.
        if (liveReaders(row.path) || statSync(row.path).mtimeMs !== row.at) continue;
        renameSync(row.path, doomed);
      } catch { continue; }
      finally { rmSync(lock, { recursive: true, force: true }); }
      rmSync(doomed, { recursive: true, force: true });
    }
    report.deleted++; report.freedBytes += row.bytes; total -= row.bytes;
  }
  report.keptBytes = total;
  return report;
}

/** Prune at most once per ten minutes; caching cannot fail a valid build.
 * @param {string} root */
function maybePrune(root) {
  const stamp = join(root, '.prune-stamp');
  try {
    if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < 600_000) return;
    writeFileSync(stamp, new Date().toISOString());
    const report = pruneShardfileCache(root);
    if (report.keptBytes > 4 * 1024 ** 3) console.warn('shardfile-cache: active entries exceed 4 GiB; pruning deferred until release');
  } catch (error) { console.warn(`shardfile-cache: prune failed: ${String(error)}`); }
}

/**
 * Bring `destination` to the product for `key`: already there, cloned from the cache, or built by `build(staging)` into a
 * fresh folder, published to the cache and cloned in. `fresh` always builds (the full build) and serves its own bytes.
 * @param {{slug:string, key:string, destination:string, cacheRoot?:string, fresh?:boolean, build:(out:string)=>Promise<void>|Promise<string>}} job
 * @returns {Promise<'slot'|'cache'|'built'>}
 */
export async function reuseOrBuild({ slug, key, destination, cacheRoot = shardfileCacheRoot(), fresh = false, build }) {
  const release = borrowShardfileEntry(join(cacheRoot, slug, key));
  try {
    const existing = fresh ? undefined : entryFor(cacheRoot, slug, key);
    const now = new Date();
    if (existing !== undefined) {
      utimesSync(existing, now, now);
      const here = readBuildKey(destination);
      // The slot's own copy counts only while its shard.json still matches the entry's byte for byte.
      if (here === key && existsSync(join(destination, 'shard.json'))
        && readFileSync(join(destination, 'shard.json')).equals(readFileSync(join(existing, 'shard.json')))) return 'slot';
      publishProduct(existing, destination);
      return 'cache';
    }
    mkdirSync(join(cacheRoot, slug), { recursive: true });
    const staging = join(cacheRoot, slug, `.staging-${process.pid}-${randomBytes(4).toString('hex')}`);
    try {
      const captured = await build(staging);
      const publishedKey = typeof captured === 'string' ? captured : key;
      writeFileSync(join(staging, KEY_FILE), `${publishedKey}\n`);
      publishProduct(staging, destination);
      const entry = join(cacheRoot, slug, publishedKey), releasePublished = borrowShardfileEntry(join(cacheRoot, slug, publishedKey));
      try {
        if (entryFor(cacheRoot, slug, publishedKey) === undefined) {
          try { rmSync(entry, { recursive: true, force: true }); renameSync(staging, entry); } catch (error) {
            // A sibling published the same key first: theirs is as good as ours.
            if (entryFor(cacheRoot, slug, publishedKey) === undefined) throw error;
          }
        } else utimesSync(entry, now, now);
        maybePrune(cacheRoot);
        return 'built';
      } finally { releasePublished(); }
    } finally { rmSync(staging, { recursive: true, force: true }); }
  } finally { release(); }
}
