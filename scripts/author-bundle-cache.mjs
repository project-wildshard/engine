// Content-addressed trusted CLI compilation; product admission still runs per product.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import * as v from 'valibot';
import { InputHashMemo } from './bake-input-hashes.mjs';
import { captureFolderInputs, matchingFolderInputKey, folderInputKey, publishFolderInputs, replayFolderInputs } from './shardfile-inputs.mjs';
import { shardfileCacheRoot } from './shardfile-cache.mjs';
import { authorBundleUseLine } from './author-bundle-usage.mjs';

/** @param {string} value */
const digest = value => createHash('sha256').update(value).digest('hex');
const Bundle = v.strictObject({ code: v.string(), modules: v.array(v.string()) });
const Saved = v.strictObject({ key: v.string(), bundle: Bundle, seal: v.string() });
const SKIPPED = new Set(['node_modules', '.git', '.worktrees', 'tmp', '.cache']);
const SOURCE = /\.(?:[cm]?[jt]sx?|json|glsl|wgsl)$/u;
/** @param {string} directory @returns {string[]} */
const entries = directory => { try { return readdirSync(directory); } catch { return []; } };
/** @param {string} directory @param {string} file */
const fileDigest = (directory, file) => {
  try { return digest(readFileSync(resolve(directory, file))); } catch { return 'missing'; }
};
/** @param {string} directory @param {string} file */
const statDigest = (directory, file) => {
  const stats = statSync(resolve(directory, file), { throwIfNoEntry: false });
  return stats === undefined ? 'missing' : `${stats.size}:${stats.mtimeMs}`;
};
// A shard's own git hook may run the CLI with GIT_DIR or GIT_INDEX_FILE set; never let them aim at the linked checkout.
const gitEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
/** @param {string} directory @param {string[]} args */
const gitText = (directory, args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', env: gitEnvironment(), maxBuffer: 64 << 20 });
/** A git checkout is HEAD, the bytes of changed tracked files, and the size and
 * mtime of untracked and individually ignored source files (generated code).
 * @param {string} directory @returns {string|undefined} */
function gitDigest(directory) {
  let head, status, ignored;
  try {
    if (realpathSync(gitText(directory, ['rev-parse', '--show-toplevel']).trim()) !== directory) return undefined;
    head = gitText(directory, ['rev-parse', 'HEAD']).trim();
    status = gitText(directory, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
    ignored = gitText(directory, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--directory']);
  } catch { return undefined; }
  const kept = (/** @type {string} */ file) => !file.endsWith('/') && !file.split('/').some(part => SKIPPED.has(part));
  const changed = status.split('\0').filter(line => line.length > 3 && kept(line.slice(3)))
    .map(line => `${line}\0${line.startsWith('??') ? statDigest(directory, line.slice(3)) : fileDigest(directory, line.slice(3))}`);
  const generated = ignored.split('\0').filter(file => kept(file) && SOURCE.test(file)).map(file => `!! ${file}\0${statDigest(directory, file)}`);
  return digest(JSON.stringify([head, [...changed, ...generated].sort()]));
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
      if (!statSync(real).isDirectory() || real.split(sep).includes('node_modules')) continue;
      // Root's own receipts and an already-keyed checkout (a workspace package inside it) need no second walk.
      if ([own, ...found.keys()].some(known => real === known || real.startsWith(known + sep))) continue;
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
  const linked = JSON.stringify(linkedSources(root));
  const args = ['author-bundle/5', root, JSON.stringify(environment), existsSync(format) ? realpathSync(format) : '', linked, ...recipe];
  const namespace = digest(JSON.stringify(args)), directory = resolve(cacheRoot, '.author-bundles', namespace);
  /** @param {string} key */
  const used = key => {
    const line = authorBundleUseLine(root, cacheRoot, namespace, key);
    if (line !== undefined) console.info(line);
  };
  const receipts = resolve(directory, 'inputs'), memo = new InputHashMemo(root);
  const key = matchingFolderInputKey(root, receipts, args, memo);
  if (key !== undefined) try {
    const saved = v.parse(Saved, JSON.parse(readFileSync(resolve(directory, `${key}.json`), 'utf8')));
    if (saved.key === key && saved.seal === digest(JSON.stringify(saved.bundle))) {
      replayFolderInputs(root, resolve(receipts, `${key}.json`));
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
    await captureFolderInputs(root, receipt, async () => { bundle = v.parse(Bundle, await compile()); });
    if (bundle === undefined) throw new Error('Author compiler produced no bundle');
    const captured = folderInputKey(root, receipt, args, new InputHashMemo(root));
    if (captured === undefined || JSON.stringify(linkedSources(root)) !== linked) throw new Error('Author compiler inputs changed');
    writeFileSync(temporary, JSON.stringify({ key: captured, bundle, seal: digest(JSON.stringify(bundle)) }));
    renameSync(temporary, resolve(directory, `${captured}.json`));
    publishFolderInputs(receipts, receipt, captured);
    replayFolderInputs(root, receipt);
    used(captured);
    return { ...bundle, reused: false };
  } finally { rmSync(receipt, { force: true }); rmSync(temporary, { force: true }); }
}
