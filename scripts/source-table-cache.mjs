// Local reuse of completed source tables after the invocation input proof.
// This receipt never grants source-program or product proof.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { InputHashMemo } from './bake-input-hashes.mjs';
import { programDiscoveryProducts } from './gen-programs.mjs';

/** @typedef {'shards-before'|'boot'|'shards-after'} TailStep */
/** @param {unknown} value */
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const shardFiles = new Set(['src/client/app/shards.generated.ts',
  'src/server/game/shard/manifest-closure.generated.json', 'lint/shard-words.generated.json']);
const bootFiles = new Set(['src/client/game/boot/bytes.generated.ts', 'src/client/game/boot/versions.generated.ts',
  'src/client/game/boot/audio.generated.ts', 'src/client/game/boot/packs.generated.ts',
  'public/assets/physics/rapier.wasm', 'scripts/boot-publication.generated.json']);
/** @param {TailStep} step @param {string} file */
function owns(step, file) {
  return step === 'boot'
    ? bootFiles.has(file) || file === 'public/assets/physics' || /^src\/(?:client|cook|server|shared)\/game\/boot\/[^/]+\.generated\.(?:ts|json)$/u.test(file)
      || /^(?:public\/assets\/packs|public\/basis)(?:\/|$)/u.test(file)
    : shardFiles.has(file) || /^src\/shards\/[^/]+\/discovery(?:\.[a-z0-9-]+)?\.generated\.ts$/u.test(file);
}

/** Memoize only complete local outputs with identical inputs, inventories and
 * bytes. Missing/changed evidence runs the defining producer; never restores.
 * The caller must finish the source input proof before using this helper.
 * @param {string} inputRoot @param {TailStep} step @param {()=>unknown} run
 * @returns {Promise<boolean>} True only for verified local reuse. */
export async function sourceTablesCached(inputRoot, step, run) {
  const root = realpathSync(resolve(inputRoot));
  // Product metadata is outside the source-table cache's input inventory.
  // Always run the defining receipt reader; a table hit cannot vouch for it.
  if (step !== 'boot' && programDiscoveryProducts(root).length > 0) { await run(); return false; }
  const directory = resolve(root, '.cache/generation-tail');
  const memo = new InputHashMemo(root, resolve(directory, 'hashes.json'));
  const receipt = resolve(directory, `${step}.json`);
  const required = step === 'boot' ? bootFiles : shardFiles;
  const snapshot = () => {
    // The phase is bound again here, while its independent verification remains
    // the source input proof's responsibility. Missing phase means no optimization.
    const phase = readFileSync(resolve(root, '.cache/generation-phase.json'), 'utf8');
    /** @type {Record<string,string>} */
    const inputs = {};
    /** @type {Record<string,string>} */
    const outputs = {};
    /** @type {string[]} */
    const directories = [];
    /** @type {string[]} */
    const outputDirectories = [];
    /** @param {string} file */
    const visit = file => {
      const path = resolve(root, file), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Linked generation tail input: ${file}`);
      if (stat.isDirectory()) {
        (owns(step, file) ? outputDirectories : directories).push(file);
        for (const child of readdirSync(path).sort((left, right) => left.localeCompare(right))) {
          if (child !== 'node_modules' && child !== '.git') visit(`${file}/${child}`);
        }
      } else if (stat.isFile()) (owns(step, file) ? outputs : inputs)[file] = memo.hash(file, true);
      else throw new Error(`Non-file generation tail input: ${file}`);
    };
    for (const folder of ['src', 'public', 'scripts', 'lint', 'vite', 'budgets']) {
      if (existsSync(resolve(root, folder))) visit(folder);
    }
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isFile()) visit(entry.name);
    }
    // The lock pins package code. Copied runtime binaries additionally bind the
    // installed bytes, so changing them cannot reuse an older boot transport.
    if (step === 'boot') for (const file of ['node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm',
      'node_modules/three/package.json', 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
      'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm']) {
      inputs[file] = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
    }
    const key = digest({ phase, inputs, directories, argv: process.argv.slice(2), node: process.version,
      platform: process.platform, arch: process.arch,
      env: Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)) });
    const body = { schema: 'generation-tail/1', root, step, key, outputs, outputDirectories };
    return { key, body: JSON.stringify(body), complete: [...required].every(file => Object.hasOwn(outputs, file)) };
  };
  try {
    let before;
    try { before = snapshot(); }
    catch { await run(); return false; }
    try {
      if (before.complete && readFileSync(receipt, 'utf8') === before.body) {
        console.info(`gen-tail: ${step}, verified local inputs and outputs`);
        return true;
      }
    } catch { /* Missing metadata runs the original writer. */ }
    await run();
    const after = snapshot();
    if (after.key !== before.key) throw new Error(`Generation tail inputs changed: ${step}`);
    if (after.complete) {
      const temporary = `${receipt}.${process.pid}.tmp`;
      try { mkdirSync(dirname(receipt), { recursive: true }); writeFileSync(temporary, after.body); renameSync(temporary, receipt); }
      finally { rmSync(temporary, { force: true }); }
    }
    return false;
  } finally { memo.flush(); }
}
