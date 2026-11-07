// Content-addressed trusted CLI compilation; product admission still runs per product.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as v from 'valibot';
import { InputHashMemo } from './bake-input-hashes.mjs';
import { captureProductInputs, matchingProductInputKey, productInputKey, publishProductInputs, replayProductInputs } from './shardfile-inputs.mjs';
import { shardfileCacheRoot } from './shardfile-cache.mjs';
import { authorBundleUseLine } from './author-bundle-usage.mjs';

/** @param {string} value */
const digest = value => createHash('sha256').update(value).digest('hex');
const Bundle = v.strictObject({ code: v.string(), modules: v.array(v.string()) });
const Saved = v.strictObject({ key: v.string(), bundle: Bundle, seal: v.string() });
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
  const args = ['author-bundle/4', root, JSON.stringify(environment), existsSync(format) ? realpathSync(format) : '', ...recipe];
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
