// Content-addressed trusted CLI compilation; product admission still runs per product.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import * as v from 'valibot';
import { InputHashMemo } from './bake-input-hashes.mjs';
import { captureProductInputs, matchingProductInputKey, productInputKey, publishProductInputs, replayProductInputs } from './shardfile-inputs.mjs';
import { shardfileCacheRoot } from './shardfile-cache.mjs';
import { authorBundleUseLine } from './author-bundle-usage.mjs';

/** @param {string} value */
const digest = value => createHash('sha256').update(value).digest('hex');
const Bundle = v.strictObject({ code: v.string(), modules: v.array(v.string()) });
const Saved = v.strictObject({ key: v.string(), bundle: Bundle, seal: v.string() });
const SKIPPED = new Set(['node_modules', '.git', '.worktrees', 'tmp', '.cache']);
/** @param {string} directory @returns {string[]} */
const entries = directory => { try { return readdirSync(directory); } catch { return []; } };
/** @param {string} directory @param {string} file */
const fileDigest = (directory, file) => {
  try { return digest(readFileSync(resolve(directory, file)).toString('base64')); } catch { return 'missing'; }
};
/** A git checkout is HEAD plus the bytes of every changed or untracked file.
 * @param {string} directory @returns {string|undefined} */
function gitDigest(directory) {
  let head, status;
  try {
    const top = execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    if (realpathSync(top) !== directory) return undefined;
    head = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    status = execFileSync('git', ['-C', directory, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch { return undefined; }
  const changed = status.split('\0').filter(line => line.length > 3).map(line => `${line}\0${fileDigest(directory, line.slice(3))}`);
  return digest(JSON.stringify([head, changed.sort()]));
}
/** Anything else is every file's path, size and modification time.
 * @param {string} directory @returns {string} */
function treeDigest(directory) {
  const hash = createHash('sha256');
  /** @param {string} at */
  const walk = at => {
    for (const name of entries(at).sort()) {
      if (SKIPPED.has(name)) continue;
      const path = resolve(at, name), stats = lstatSync(path, { throwIfNoEntry: false });
      if (stats?.isDirectory() === true) walk(path);
      else if (stats !== undefined) hash.update(`${relative(directory, path)}\0${stats.size}\0${stats.mtimeMs}\n`);
    }
  };
  walk(directory);
  return hash.digest('hex');
}
/** J196 links put source checkouts (sharddev, engine, format) behind node_modules
 * symlinks that resolve outside root. Receipts skip node_modules and everything
 * outside root, so those linked bytes key the namespace instead; pnpm-installed
 * packages resolve inside a node_modules store and stay keyed by their pins.
 * @param {string} root @returns {string[]} */
export function linkedSources(root) {
  const own = realpathSync(root), found = new Map();
  /** @param {string} base */
  const visit = base => {
    const modules = resolve(base, 'node_modules');
    const names = entries(modules).flatMap(name => name.startsWith('@') ? entries(resolve(modules, name)).map(child => `${name}/${child}`) : [name]);
    for (const name of names.filter(entry => !entry.startsWith('.')).sort()) {
      let real;
      try { real = realpathSync(resolve(modules, name)); } catch { continue; }
      if (!statSync(real).isDirectory() || real.split(sep).includes('node_modules') || found.has(real)) continue;
      if (real === own || real.startsWith(own + sep)) continue;
      found.set(real, '');
      found.set(real, gitDigest(real) ?? treeDigest(real));
      visit(real);
    }
  };
  visit(own);
  return [...found].map(([path, value]) => `${path}=${value}`).sort();
}
/** Cache only a completed compiler with its full native bundler/read receipt.
 * Every hit verifies current inputs and body integrity, then replays the exact
 * dependency evidence into the enclosing product. Missing evidence compiles.
 * @param {string} root @param {string[]} recipe
 * @param {()=>Promise<{code:string,modules:string[]}>} compile
 * @param {string} [cacheRoot] */
export async function authorBundleCached(root, recipe, compile, cacheRoot = shardfileCacheRoot()) {
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => name.startsWith('VITE_') || name === 'NODE_ENV' || name === 'NODE_OPTIONS')
    .sort(([left], [right]) => left.localeCompare(right)));
  // Receipts skip node_modules, so the installed format's real path (it names the commit) stands for its bytes.
  const format = resolve(root, 'node_modules/@wildshard/format');
  const args = ['author-bundle/5', root, JSON.stringify(environment), existsSync(format) ? realpathSync(format) : '', JSON.stringify(linkedSources(root)), ...recipe];
  const namespace = digest(JSON.stringify(args)), directory = resolve(cacheRoot, '.author-bundles', namespace);
  /** @param {string} key */
  const used = key => {
    const line = authorBundleUseLine(root, cacheRoot, namespace, key);
    if (line !== undefined) console.info(line);
  };
  const receipts = resolve(directory, 'inputs'), memo = new InputHashMemo(root);
  const key = matchingProductInputKey(root, receipts, args, memo);
  if (key !== undefined) try {
    const saved = v.parse(Saved, JSON.parse(readFileSync(resolve(directory, `${key}.json`), 'utf8')));
    if (saved.key === key && saved.seal === digest(JSON.stringify(saved.bundle))) {
      replayProductInputs(root, resolve(receipts, `${key}.json`));
      used(key);
      return { ...saved.bundle, reused: true };
    }
  } catch { /* A missing/corrupt compiled transform never grants reuse. */ }
  mkdirSync(directory, { recursive: true });
  const receipt = resolve(directory, `${process.pid}-${randomBytes(8).toString('hex')}.inputs`);
  const temporary = `${receipt}.bundle`;
  try {
    /** @type {{code:string,modules:string[]}|undefined} */
    let bundle;
    await captureProductInputs(root, receipt, async () => { bundle = v.parse(Bundle, await compile()); });
    if (bundle === undefined) throw new Error('Author compiler produced no bundle');
    const captured = productInputKey(root, receipt, args, new InputHashMemo(root));
    if (captured === undefined) throw new Error('Author compiler inputs changed');
    writeFileSync(temporary, JSON.stringify({ key: captured, bundle, seal: digest(JSON.stringify(bundle)) }));
    renameSync(temporary, resolve(directory, `${captured}.json`));
    publishProductInputs(receipts, receipt, captured);
    replayProductInputs(root, receipt);
    used(captured);
    return { ...bundle, reused: false };
  } finally { rmSync(receipt, { force: true }); rmSync(temporary, { force: true }); }
}
