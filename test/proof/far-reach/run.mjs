// Sky Reach's whole-shard witness in plain Node: no browser, DOM shim, renderer or active application.
// `all` (and `headless` / `replay` / `ledger`) plays the whole spawn → Roc tape: the authoritative witness, compatibility.json.
// The `slice-*` modes are the CI-budget legs, resumed from the committed checkpoints; `checkpoints` regenerates those from
// the whole tape and `fresh` refuses a set written from other headless inputs.
// oxlint-disable-next-line import/no-nodejs-modules -- Fail the native witness if browser globals or an invalid proof mode are present.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Native proof mode and failure status are CLI results, not game configuration.
import process from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- The checkpoints' inputs hash: every repo module the witness loads.
import { registerHooks } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the loaded modules' and the read assets' bytes.
import { readFileSync, readdirSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the loaded modules' and the read assets' bytes.
import { createHash } from 'node:crypto';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
const ROOT = new URL('../../../', import.meta.url), loaded = new Set();
registerHooks({ load(url, context, next) { if (url.startsWith(ROOT.href) && !url.includes('/node_modules/')) loaded.add(url); return next(url, context); } });
const { installPortableMath } = await import('../../fake/portableMath.ts'); installPortableMath();
await import('./worker.ts'); // Fence the actual worker adapter's defining bytes too.
const { installAppIdentity } = await import('../../../src/shared/engine/app/identity.ts');
const { WILDSHARD_IDENTITY } = await import('../../../src/client/game/identity.ts');
const witness = await import('./witness.ts');
installAppIdentity(WILDSHARD_IDENTITY);

/** The headless inputs: every repo module the witness loaded (the runtime, the engine, the tape), the physics module and the shard's assets. */
function inputFiles() {
  const assets = new URL('src/shards/far-reach/assets/', ROOT);
  return [...loaded, ...['test/proof/far-reach/run.mjs', 'scripts/sim-node-loader.mjs', 'pnpm-lock.yaml', 'public/assets/physics/rapier.wasm'].map(path => new URL(path, ROOT).href), ...readdirSync(assets).map(name => new URL(name, assets).href)];
}
function inputs() {
  const files = [...new Set(inputFiles())].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const hash = createHash('sha256');
  for (const url of files) hash.update(url.slice(ROOT.href.length)).update('\0').update(readFileSync(new URL(url))).update('\0');
  return hash.digest('hex');
}

const { generateWitness } = await import('../../../scripts/witness-generation.mjs');
const mode = process.argv.at(2) ?? 'all';
let checkpointResult;
if (mode !== 'fresh') {
  const fingerprint = inputs();
  const generated = await generateWitness({ root: ROOT, slug: 'far-reach', inputs: fingerprint, files: inputFiles(),
    manifest: new URL('checkpoints/manifest.json', import.meta.url), select: witness.setCheckpointDirectory,
    generate: async () => witness.writeCheckpoints(await witness.skyRapier(), fingerprint),
    record: mode === 'checkpoints', forceCompare: mode === 'checkpoints' || mode === 'compare-checkpoints', compare: !['checkpoints', 'cache-record'].includes(mode) });
  if (['checkpoints', 'cache-record', 'compare-checkpoints', 'cache-verify', 'checkpoint-directory'].includes(mode)) checkpointResult = { status: 'generated', inputs: fingerprint, directory: generated.directory, key: generated.key, hit: generated.hit, manifest: generated.manifest };
}

const proofs = { headless: witness.headlessProof, replay: witness.replayProof, ledger: witness.ledgerProof };
const slices = { 'slice-step': witness.stepSlice, 'slice-replay': witness.replaySlice, 'slice-storm': witness.stormSlice, 'slice-ledger': witness.ledgerSlice };
if (checkpointResult !== undefined) console.info(JSON.stringify(checkpointResult));
else if (mode === 'fresh') {
  const result = witness.checkpointsFresh(inputs());
  console.info(JSON.stringify(result)); process.exitCode = result.status === 'fresh' ? 0 : 1;

} else if (mode in slices) {
  const result = await slices[mode](await witness.skyRapier());
  console.info(JSON.stringify({ slug: 'far-reach', entry: witness.ENTRY, [mode]: result })); process.exitCode = result.status === 'passed' ? 0 : 1;
} else {
  if (mode !== 'all' && !(mode in proofs)) throw new Error('Unknown compatibility proof mode');
  const rapier = await witness.skyRapier(), results = {};
  for (const [name, proof] of Object.entries(proofs)) if (mode === 'all' || mode === name) results[name] = await proof(rapier);
  const compatible = Object.keys(proofs).every(name => results[name]?.status === 'passed');
  console.info(JSON.stringify({ slug: 'far-reach', entry: witness.ENTRY, compatible, ...results }));
  process.exitCode = compatible || (mode !== 'all' && results[mode]?.status === 'passed') ? 0 : 1;
}
