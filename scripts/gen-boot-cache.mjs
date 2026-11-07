// Commit-only reuse; ordinary builds still run the defining boot-table producer.
import { createHash } from 'node:crypto';
import fs, { existsSync, globSync as globPaths, lstatSync, mkdirSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inputValue, treeEntries } from './input-snapshot.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const preloaded = process.execArgv.some((arg, i) => arg === '--import'
  && typeof process.execArgv[i + 1] === 'string' && resolve(process.execArgv[i + 1]) === import.meta.filename);
const modules = new Set([`F ${import.meta.filename}`, `F ${resolve(ROOT, 'scripts/input-snapshot.mjs')}`]);
/** @type {Set<string> | null} */
let reads = null;
/** @type {Set<string> | null} */
let writes = null;
/** @param {string} kind @param {unknown} value */
function note(kind, value) {
  if (reads === null) return;
  if (typeof value === 'string') reads.add(`${kind} ${resolve(value)}`);
  else if (value instanceof URL && value.protocol === 'file:') reads.add(`${kind} ${fileURLToPath(value)}`);
}
if (preloaded) {
  registerHooks({
    load(url, context, next) {
      if (url.startsWith('file:')) modules.add(`F ${fileURLToPath(url)}`);
      return next(url, context);
    },
    resolve(specifier, context, next) {
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.js']) modules.add(`F ${base + suffix}`);
      }
      return next(specifier, context);
    }
  });
  /** @type {Record<string, unknown>} */
  const table = fs;
  /** @type {[string, string[]][]} */
  const groups = [['F', ['readFileSync', 'existsSync', 'statSync', 'lstatSync', 'realpathSync', 'openSync', 'accessSync', 'writeFileSync', 'copyFileSync']], ['D', ['readdirSync', 'opendirSync']]];
  for (const [kind, names] of groups) for (const name of names) {
    const original = table[name];
    if (typeof original !== 'function') continue;
    table[name] = /** @this {unknown} @param {...unknown} args */ function tracedFile(...args) {
      note(kind, args[0]);
      if (name === 'copyFileSync') note('F', args[1]);
      if (writes !== null && (name === 'writeFileSync' || name === 'copyFileSync')) {
        const output = args[name === 'copyFileSync' ? 1 : 0];
        if (typeof output === 'string') writes.add(resolve(output));
        else if (output instanceof URL && output.protocol === 'file:') writes.add(fileURLToPath(output));
      }
      return Reflect.apply(original, this, args);
    };
  }
  const glob = table.globSync;
  if (typeof glob === 'function') table.globSync = /** @this {unknown} @param {...unknown} args */ function globSync(...args) {
    const options = args[1];
    const at = options !== null && typeof options === 'object' && 'cwd' in options ? options.cwd : process.cwd();
    const cwd = typeof at === 'string' ? resolve(at) : at instanceof URL ? fileURLToPath(at) : process.cwd();
    if (reads !== null) for (const item of Array.isArray(args[0]) ? args[0] : [args[0]]) {
      if (typeof item === 'string') reads.add(`G ${cwd}\t${item}`);
    }
    return Reflect.apply(glob, this, args);
  };
  syncBuiltinESMExports();
}

/** Reuse only exact traced inputs and produced bytes; untraced invocation always runs.
 * @param {string} inputRoot @param {string} cache @param {()=>void} run @returns {boolean} Verified cache hit. */
export function generateBootTablesCached(inputRoot, cache, run) {
  const root = resolve(inputRoot);
  if (!preloaded || root !== ROOT) { run(); return false; }
  const digest = (/** @type {unknown} */ value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const context = { node: process.version, platform: process.platform, arch: process.arch,
    environment: digest(Object.fromEntries(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)))) };
  // A different lane/environment must not evict this context's evidence.
  const directory = resolve(cache, 'boot'), receipt = resolve(directory, `${digest(context)}.json`), blobs = resolve(cache, '../blobs');
  const bytesHash = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');
  const outputPath = (/** @type {string} */ file) => /^(src|public)\//u.test(file) && !file.includes('\\') && file.split('/').every(part => part !== '' && part !== '.' && part !== '..');
  /** @type {string[]} */
  const restored = [], createdDirectories = [];
  const undoRestore = () => {
    for (const file of restored) rmSync(file, { force: true });
    for (const dir of createdDirectories.sort((a,b) => b.length-a.length)) rmdirSync(dir);
  };
  try {
    const saved = JSON.parse(readFileSync(receipt, 'utf8'));
    if (saved.digest === digest({ context: saved.context, inputs: saved.inputs, outputs: saved.outputs })
      && JSON.stringify(saved.context) === JSON.stringify(context)
      && saved.inputs !== null && typeof saved.inputs === 'object' && Object.keys(saved.inputs).length > 2
      && saved.outputs !== null && typeof saved.outputs === 'object' && !Array.isArray(saved.outputs)
      && Object.entries(saved.outputs).every(([file, hash]) => outputPath(file) && typeof hash === 'string'
        && /^[a-f0-9]{64}$/u.test(hash) && saved.inputs[`F ${file}`] === hash)
      && Object.entries(saved.inputs).filter(([entry]) => entry.startsWith('F ') && !Object.hasOwn(saved.outputs, entry.slice(2))
        && !Object.keys(saved.outputs).some(file => file.startsWith(`${entry.slice(2)}/`)))
        .every(([entry, value]) => inputValue(root, entry) === value)) {
      // A fresh staged export lacks untracked outputs. Restore only absent
      // exact output blobs, then verify the complete inventories and inputs.
      // Existing corrupt bytes require the real producer, never overwrite.
      for (const [file, hash] of Object.entries(saved.outputs)) {
        const target = resolve(root, file);
        if (existsSync(target)) continue;
        const bytes = readFileSync(resolve(blobs, String(hash)));
        if (bytesHash(bytes) !== hash) throw new Error(`Corrupt boot output: ${file}`);
        const missing = [];
        for (let dir = dirname(target); dir !== root && !existsSync(dir); dir = dirname(dir)) missing.push(dir);
        for (let dir = dirname(target); dir.startsWith(root + sep); dir = dirname(dir)) {
          if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error(`Linked boot output directory: ${file}`);
        }
        mkdirSync(dirname(target), { recursive: true }); createdDirectories.push(...missing);
        writeFileSync(target, bytes, { flag: 'wx' }); restored.push(target);
      }
      if (Object.entries(saved.inputs).every(([entry, value]) => inputValue(root, entry) === value)) {
        console.log(`gen-boot: verified input/output receipt (${restored.length} outputs restored)`); return true;
      }
    }
  } catch { /* Missing or corrupt evidence runs the real producer. */ }
  undoRestore();
  /** @type {string[]} */
  let direct = [];
  const produced = new Set();
  reads = new Set(); writes = produced;
  try { run(); direct = [...modules, ...reads]; } finally { reads = null; writes = null; }
  const entries = treeEntries(root, direct);
  // Writers need not read their outputs. Bind bytes and the output inventory.
  const patterns = ['src/client/game/boot/**/*.generated.*', 'public/assets/packs/**/*'];
  for (const pattern of patterns) entries.push(`G .\t${pattern}`);
  for (const path of globPaths(patterns, { cwd: root })) if (lstatSync(resolve(root, path)).isFile()) produced.add(resolve(root, path));
  const outputs = {};
  mkdirSync(blobs, { recursive: true });
  for (const target of produced) {
    const file = relative(root, target);
    if (!outputPath(file) || !lstatSync(target).isFile()) throw new Error(`Invalid boot output: ${file}`);
    const bytes = readFileSync(target), hash = bytesHash(bytes), object = resolve(blobs, hash);
    if (!existsSync(object) || bytesHash(readFileSync(object)) !== hash) writeFileSync(object, bytes);
    outputs[file] = hash; entries.push(`F ${file}`);
  }
  for (const file of ['scripts/gen-boot-cache.mjs', 'scripts/input-snapshot.mjs', 'pnpm-lock.yaml', 'package.json',
    ...['engine', 'game', 'sdk', 'sharddev', 'commons'].map(layer => `src/${layer}/package.json`)]) {
    if (existsSync(resolve(root, file))) entries.push(`F ${file}`);
  }
  const inputs = Object.fromEntries([...new Set(entries)].map(entry => [entry, inputValue(root, entry)]));
  mkdirSync(directory, { recursive: true });
  writeFileSync(receipt, JSON.stringify({ context, inputs, outputs, digest: digest({ context, inputs, outputs }) }));
  return false;
}
