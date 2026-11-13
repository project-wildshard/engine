// Read-only product selection and the exact recipe shared with the normal builder.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import * as v from 'valibot';
import { createRequire } from 'node:module';
import { mapStampPath, mapSettingsPath, mapTilesHash } from './map-hash.mjs';
import { borrowShardfileEntry, readBuildKey, shardfileCacheRoot } from './shardfile-cache.mjs';
import { InputHashMemo } from './bake-input-hashes.mjs';
import { productInputKey, productToolchainKey, matchingProductInputKey } from './shardfile-inputs.mjs';
import { hasShardSource, productFolder, shardSourceDir } from './shard-outputs.mjs';
import { shardfileValidationRevision } from './shardfile-validation-revision.mjs';

// VITEST-BENCH VB14: the boundary lint pulls in Vite, Rolldown, sharp and semver. Only a source shard's runtime
// check needs it, so a pinned product read (every test that reads a product) never loads that graph.
const require = createRequire(import.meta.url);
/** @returns {typeof import('../lint/shardfile-boundaries.mjs').shardfileBoundaryViolations} */
const shardfileBoundaryViolations = () => /** @type {typeof import('../lint/shardfile-boundaries.mjs')} */ (require('../lint/shardfile-boundaries.mjs')).shardfileBoundaryViolations;
/** Exact closed-runtime copy admission shared by the builder and read-only product consumers.
 * @param {string} root @param {string} project */
export function runtimeCopyIssues(root, project) {
  /** @type {{file:string,message:string}[]} */
  const issues = [];
  /** @type {Set<string>} */
  const executable = new Set();
  /** @param {string} directory */
  const walk = directory => {
    if (!existsSync(directory)) return;
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, file.name);
      if (file.isDirectory()) walk(path);
      else if (file.name.endsWith('.ts')) {
        if (!file.name.endsWith('.d.ts')) executable.add(path);
        for (const issue of shardfileBoundaryViolations()(root, path.slice(root.length + 1), readFileSync(path, 'utf8')).filter(row => row.rule === 'runtime-standalone')) issues.push({ file: path.slice(project.length + 1), message: issue.message });
      }
    }
  };
  walk(resolve(project, 'runtime'));
  if (executable.size > 0 && !existsSync(resolve(project, 'runtime/index.ts'))) issues.push({ file: 'runtime/index.ts', message: 'Closed runtime requires its compiled index entry' });
  return issues;
}
/** Root map identity for source programs, or the existing admitted image stamp for legacy bakers.
 * @param {string} project @param {string|undefined} output
 * @returns {{image?:string,tilesHash:string,pixelHash?:string}|undefined} */
export function productMapInput(project, output) {
  const settings = mapSettingsPath(project);
  if (existsSync(settings)) {
    const parsed = v.parse(v.object({ painter: v.optional(v.object({ program: v.optional(v.boolean(), false) })) }), JSON.parse(readFileSync(settings, 'utf8')));
    if (parsed.painter?.program === true) return { tilesHash: mapTilesHash(project) };
  }
  const stamp = output === undefined ? mapStampPath(project) : resolve(project, `look/map.${output}.baked.json`);
  return existsSync(stamp) ? v.parse(v.object({ image: v.string(), tilesHash: v.string(), pixelHash: v.optional(v.string()) }), JSON.parse(readFileSync(stamp, 'utf8'))) : undefined;
}
/** @param {string} root @param {string|undefined} output
 * @param {{image?:string,tilesHash:string}|undefined} map @param {boolean} copy */
export function productFlags(root, output, map, copy) {
  return [...(copy ? ['--copy-runtime'] : []), ...(map === undefined ? [] : map.image === undefined ? [`--generated-map-tiles-hash=${map.tilesHash}`] : [`--map=${resolve(root, 'public', map.image.slice(1))}`, `--map-tiles-hash=${map.tilesHash}`]), ...(output === undefined ? [] : [`--output=${output}`])];
}
/** @param {string} root @param {string} name @param {string[]} flags
 * @param {string} toolchain @param {string} cacheRoot */
export function productRecipe(root, name, flags, toolchain, cacheRoot) {
  const normalized = flags.map(flag=>flag.replace(root,'<root>'));
  const recipe = [name,...normalized,toolchain];
  const receipts = resolve(cacheRoot,'.inputs-v2',name,createHash('sha256').update(JSON.stringify(recipe)).digest('hex'));
  return { normalized, recipe, receipts };
}
/** Slot-owned proof is build metadata, outside every shipped product. Shared
 * cache eviction must not strand a completed product between CLI phases.
 * @param {string} root @param {string} name */
function slotInputReceipt(root, name) {
  if (!/^[a-z0-9_-]+$/u.test(name)) throw new Error('Invalid built product name');
  return resolve(root, 'out/.app/product-inputs', `${name}.json`);
}
/** Preserve the original sealed receipt, never a new freshness assertion.
 * Readers replay every original source/tool/host check and bind its key to the
 * product's own buildKey. Publish before shared cache pruning can remove it.
 * @param {string} root @param {string} name @param {string} receipt
 * @param {string} key @param {string[]} recipe
 * @param {InputHashMemo} memo */
export function retainProductInputs(root, name, receipt, key, recipe, memo) {
  if (!/^[a-f0-9]{64}$/u.test(key) || productInputKey(root, receipt, recipe, memo) !== key) throw new Error(`Current product input receipt differs: ${name}`);
  const path = slotInputReceipt(root, name), temporary = `${path}.${process.pid}-${randomBytes(8).toString('hex')}.tmp`;
  mkdirSync(dirname(path), {recursive: true});
  try { writeFileSync(temporary, readFileSync(receipt), {flag: 'wx'}); renameSync(temporary, path); }
  finally { rmSync(temporary, {force: true}); }
}
/** Locate a normal build's product without generating or publishing bytes.
 * A cache path loan remains pinned through this consumer process's lifetime.
 * CI consumes its exact build output: WS_TEST_PRODUCTS_SHA (set by ci-checks once the run's artifacts verify) must equal
 * the checkout's GITHUB_SHA. Local callers require a matching sealed input receipt.
 * The caller still admits the returned product's complete bytes through its normal loader.
 * @param {string} sourceRoot @param {string} name
 * @param {{cacheRoot?:string,env?:NodeJS.ProcessEnv}} [options] */
export function readBuiltShardfile(sourceRoot, name, { cacheRoot = shardfileCacheRoot(), env = process.env } = {}) {
  if (!/^[a-z0-9_-]+$/u.test(name)) throw new Error('Invalid built product name');
  const root = resolve(sourceRoot);
  const destination = resolve(root, 'out', name), built = env.WS_TEST_PRODUCTS_SHA;
  if (built !== undefined && /^[a-f0-9]{40}$/u.test(built) && built === env.GITHUB_SHA
    && existsSync(resolve(destination, 'shard.json'))) return destination;
  // P3: no shard source to rebuild from, so a product is a pinned shardfile (J65) or it is missing.
  if (!hasShardSource(root)) {
    if (existsSync(resolve(destination, 'shard.json'))) return destination;
    const slice = resolve(root, 'out/.slices', name);
    if (existsSync(resolve(slice, 'shard.json'))) return slice;
    throw new Error(`No shard source and no pinned product: ${name}`);
  }
  const folder = productFolder(root, name), project = shardSourceDir(root, folder);
  const output = name === folder ? undefined : name;
  const map = productMapInput(project, output);
  const flags = productFlags(root, output, map, runtimeCopyIssues(root, project).length === 0);
  const memo = new InputHashMemo(root);
  const toolchain = `${productToolchainKey(root,memo)}:${shardfileValidationRevision(root)}`;
  const { recipe, receipts } = productRecipe(root, name, flags, toolchain, cacheRoot);
  const here = readBuildKey(destination);
  if (here !== '' && productInputKey(root, slotInputReceipt(root, name), recipe, memo) === here
    && existsSync(resolve(destination, 'shard.json'))) return destination;
  // A lazy consumer's product loan also needs its original freshness proof on
  // later discovery reads. Pin both, rather than only the cached body below.
  borrowShardfileEntry(receipts, true);
  const key = matchingProductInputKey(root, receipts, recipe, memo);
  if (key !== undefined) for (const directory of [destination, resolve(cacheRoot, name, key)]) {
    if (directory !== destination) {
      // Lazy product readers keep using the returned directory after this call.
      // Dead-process pins are reaped by the same ordinary cache eviction.
      borrowShardfileEntry(directory, true);
      if (existsSync(`${directory}.lock`)) continue;
    }
    if (readBuildKey(directory) === key && existsSync(resolve(directory, 'shard.json'))) return directory;
  }
  throw new Error(`Missing current product ${name}; run: node scripts/build-shardfiles.mjs --reuse --shard=${name}`);
}

/** Classify selected suites once, before workers load setup or tests.
 * Uses the same exact-SHA/current-input admission as each suite's reader.
 * Never builds, restores source outputs or accepts an older cached product.
 * @param {string} root @param {readonly string[]} files
 * @param {{cacheRoot?:string,env?:NodeJS.ProcessEnv}} [options] */
export function selectBuiltTestProducts(root, files, options = {}) {
  const registry = resolve(root, 'scripts/test-products.json');
  /** @type {Record<string,string[]>} */
  const products = existsSync(registry) ? v.parse(v.record(v.string(), v.array(v.string())), JSON.parse(readFileSync(registry, 'utf8'))) : {};
  const selected = files.filter(file => (products[file]?.length ?? 0) > 0);
  /** @type {Set<string>} */
  const missing = new Set();
  for (const name of new Set(selected.flatMap(file => products[file] ?? []))) {
    try { readBuiltShardfile(root, name, options); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith(`Missing current product ${name};`)) throw error;
      missing.add(name);
    }
  }
  const names = [...missing].sort();
  const suites = selected.filter(file => products[file]?.some(name => missing.has(name))).sort();
  const blocked = new Set(suites);
  return { ready: files.filter(file => !blocked.has(file)), blocked: suites, missing: names,
    buildCommand: names.length === 0 ? undefined : `node scripts/build-shardfiles.mjs --reuse --shard=${names.join(',')}` };
}
/** Strict full/focused/CI preflight; no unavailable suite may disappear.
 * @param {string} root @param {readonly string[]} files
 * @param {{cacheRoot?:string,env?:NodeJS.ProcessEnv}} [options] */
export function assertBuiltTestProducts(root, files, options = {}) {
  const {missing,blocked,buildCommand}=selectBuiltTestProducts(root, files, options);
  if(missing.length>0)throw new Error(`Missing current products ${missing.join(', ')} (no verified product matches current inputs), required by ${blocked.join(', ')}; run: ${buildCommand}`);
}


/** Publish the existing public map alias from the admitted product, never from an intermediate source file.
 * @param {string} root @param {string} name @param {string} folder @param {string} expectedSourceHash */
export async function publishProductMap(root, name, folder, expectedSourceHash) {
  if (!/^[a-z0-9_-]+$/u.test(name)) throw new Error('Invalid program-map product name');
  const { outputFormat } = await import('./shard-platform-format.mjs');
  const envelope = readFileSync(resolve(folder, 'shard.json'));
  const receipt = JSON.parse(readFileSync(resolve(folder, 'validation.json'), 'utf8'));
  if (receipt.indexHash !== createHash('sha256').update(envelope).digest('hex')) throw new Error(`${name}: generated map index receipt differs`);
  const index = outputFormat.parseOutputIndex(JSON.parse(envelope.toString('utf8')));
  const section = index.sections.find(row => row.name === 'look/map');
  if (section === undefined) throw new Error(`${name}: missing generated map section`);
  const wire = readFileSync(resolve(folder, section.path));
  if (wire.length !== section.bytes || createHash('sha256').update(wire).digest('hex') !== section.hash) throw new Error(`${name}: generated map section differs`);
  const map = v.parse(v.object({ map: v.object({ image: v.string(), tilesHash: v.string() }) }), outputFormat.parseOutputSection(section.name, JSON.parse(wire.toString('utf8')))).map;
  const file = index.files.find(row => row.hash === map.image && row.kind === 'image');
  if (file === undefined || map.tilesHash !== expectedSourceHash) throw new Error(`${name}: generated map differs from current world inputs`);
  const bytes = readFileSync(resolve(folder, file.path));
  if (bytes.length !== file.compressed || createHash('sha256').update(bytes).digest('hex') !== file.hash) throw new Error(`${name}: generated map image differs`);
  const image = resolve(root, 'public/assets', name, 'map/top.webp');
  mkdirSync(dirname(image), { recursive: true }); writeFileSync(image, bytes);
}
