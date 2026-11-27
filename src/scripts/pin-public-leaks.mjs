// Standalone shardfiles SF11 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-standalone-shardfiles-PLAN.md, J525): a zone's
// art lives only in its shardfile, and a page reads it from the cook (fix preview PV4). So `pins.ts install` writes
// `out/<folder>` and nothing under `public/`, and no build copies a pinned zone's bytes onto the page. This finds a leak:
//   - a row in the pins ledger (`out/.pins.json` `published`): a pin wrote under public/;
//   - a file under public/ that Git doesn't track and that holds a pinned blob's or mount's bytes;
//   - a file in a build's dist/ that holds them.
// A pinned file's bytes are its SHA-256: a blob is named by it (`blobs/<kind>/<sha256>.<ext>`), a mount is hashed. A mount
// whose bytes are a tracked engine file under public/ is engine art (the piano pair), never a leak.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {pathToFileURL} from 'node:url';

const BLOB = /^([a-f0-9]{64})\.[\w.]+$/u;
const sha256 = (/** @type {string} */ file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every regular file under `dir`, as paths relative to it. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, {withFileTypes: true, recursive: true}).filter(entry => entry.isFile() && entry.name !== '.DS_Store')
    .map(entry => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/')).sort();
}

/** The public/ paths Git tracks under `root` (empty outside a Git tree). @param {string} root @returns {Set<string>} */
export function trackedPublicPaths(root) {
  try {
    return new Set(execFileSync('git', ['ls-files', '-z', 'public'], {cwd: root, encoding: 'utf8', maxBuffer: 64 << 20}).split('\0').filter(Boolean));
  } catch { return new Set(); }
}

/** The pinned products' bytes, by SHA-256 then byte size: each pin receipt's folder under out/, its blobs and its mounts.
 * @param {string} root @param {{tracked?: ReadonlySet<string>}} [options] @returns {Map<number, Map<string, string>>} size -> hash -> where */
export function pinnedBytes(root, {tracked = trackedPublicPaths(root)} = {}) {
  /** @type {Map<number, Map<string, string>>} */ const bySize = new Map();
  const engine = new Set([...tracked].flatMap(path => existsSync(join(root, path)) ? [sha256(join(root, path))] : []));
  const out = join(root, 'out');
  const add = (/** @type {number} */ bytes, /** @type {string} */ hash, /** @type {string} */ where) => {
    if (engine.has(hash)) return;
    const row = bySize.get(bytes) ?? new Map();
    if (!row.has(hash)) row.set(hash, where);
    bySize.set(bytes, row);
  };
  for (const folder of existsSync(out) ? readdirSync(out).sort() : []) {
    const receipt = join(out, folder, 'validation.json');
    if (!existsSync(receipt)) continue;
    try { if (typeof JSON.parse(readFileSync(receipt, 'utf8'))?.pin?.hash !== 'string') continue; } catch { continue; }
    for (const path of filesUnder(join(out, folder, 'blobs'))) {
      const name = BLOB.exec(path.split('/').pop() ?? '')?.[1], file = join(out, folder, 'blobs', path);
      add(statSync(file).size, name ?? sha256(file), `out/${folder}/blobs/${path}`);
    }
    for (const path of filesUnder(join(out, folder, 'mounts/assets'))) {
      const file = join(out, folder, 'mounts/assets', path);
      add(statSync(file).size, sha256(file), `out/${folder}/mounts/assets/${path}`);
    }
  }
  return bySize;
}

/** The files under `dir` whose bytes are a pinned file's. @param {string} dir @param {Map<number, Map<string, string>>} pinned
 * @param {(path: string) => boolean} [skip] @returns {{path: string, pinned: string}[]} */
function holding(dir, pinned, skip = () => false) {
  const found = [];
  for (const path of filesUnder(dir)) {
    if (skip(path)) continue;
    const file = join(dir, path), sizes = pinned.get(statSync(file).size);
    if (sizes === undefined) continue;
    const where = sizes.get(sha256(file));
    if (where !== undefined) found.push({path, pinned: where});
  }
  return found;
}

/** What a pin put where SF11 says none goes. With `dist`, that build output is read too.
 * @param {string} root @param {{dist?: string, tracked?: ReadonlySet<string>}} [options]
 * @returns {{ledger: string[], public: {path: string, pinned: string}[], dist: {path: string, pinned: string}[]}} */
export function pinPublicLeaks(root, {dist, tracked = trackedPublicPaths(root)} = {}) {
  const file = join(root, 'out/.pins.json');
  let ledger = [];
  try { ledger = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).published ?? [] : []; } catch { ledger = ['out/.pins.json (unreadable)']; }
  const pinned = pinnedBytes(root, {tracked});
  return {
    ledger: ledger.map(String),
    public: holding(join(root, 'public'), pinned, path => tracked.has(`public/${path}`)).map(row => ({...row, path: `public/${row.path}`})),
    dist: dist === undefined ? [] : holding(dist, pinned),
  };
}

/** Throws naming the first leaks, for the build and `pins.ts install`. @param {string} root @param {{dist?: string}} [options] */
export function assertNoPinPublicLeaks(root, options = {}) {
  const leaks = pinPublicLeaks(root, options), lines = [
    ...leaks.ledger.map(path => `the pins ledger names ${path}`),
    ...leaks.public.map(row => `${row.path} holds ${row.pinned}`),
    ...leaks.dist.map(row => `${options.dist}/${row.path} holds ${row.pinned}`),
  ];
  if (lines.length > 0) {
    throw new Error(`A zone's art lives only in its shardfile and the page reads it from the cook (SF11), but ${lines.length} pinned file(s) reached public/ or the build: ${lines.slice(0, 5).join('; ')}${lines.length > 5 ? '; …' : ''}`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dist] = process.argv.slice(2);
  assertNoPinPublicLeaks(process.cwd(), dist === undefined ? {} : {dist});
  console.log(`pin public leaks: none${dist === undefined ? '' : ` (public/ and ${dist})`}`);
}
