// Nine Dragon's renderer-free witness. Checkpoints are regenerated explicitly and fenced by every loaded repo input.
// oxlint-disable-next-line import/no-nodejs-modules -- Proof CLI assertions reject browser globals.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- The proof mode and exit code are CLI outputs.
import process from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Capture the exact loaded headless closure for checkpoint freshness.
import { registerHooks } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Read proof inputs, never live gameplay saves.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The checkpoint input fence is a SHA256 over source and asset bytes.
import { createHash } from 'node:crypto';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
const ROOT = new URL('../../../', import.meta.url), loaded = new Set([import.meta.url]);
registerHooks({ load(url, context, next) { if (url.startsWith(ROOT.href) && !url.includes('/node_modules/')) loaded.add(url); return next(url, context); } });
await import('../../../src/shared/engine/core/portableMathFirst.ts');
const { installAppIdentity } = await import('../../../src/shared/engine/app/identity.ts');
const { WILDSHARD_IDENTITY } = await import('../../../src/client/game/identity.ts');
const witness = await import('./witness.ts');
// Admission loads this exact entry in every mode, so fresh/checkpoints/replay hash the same runtime closure.
await import('../../fixtures/nine-headless.ts');
// Retired shipping copies are fenced typed facts in the original direct factories.
const oracleFiles = ['test/fixtures/nine-native-oracle-inputs.ts', 'test/fixtures/nine-native-constants-inputs.ts',
  'test/fixtures/nine-native-oracle.ts', 'test/fixtures/nine-native-constants.ts', 'test/fixtures/native-oracle.ts',
  'test/fixtures/native-program.ts'].map(path => new URL(path, ROOT).href);
installAppIdentity(WILDSHARD_IDENTITY);
function inputFiles() { return [...loaded, ...oracleFiles, ...['src/shards/nine-dragon-stack/data/headlessAssembly.json', 'test/proof/nine-dragon-stack/run.mjs', 'test/fixtures/headless/worker.ts', 'scripts/sim-node-loader.mjs', 'pnpm-lock.yaml', 'public/assets/physics/rapier.wasm'].map(path => new URL(path, ROOT).href)]; }
function inputs() {
  const files = [...new Set(inputFiles())].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const hash = createHash('sha256');
  for (const url of files) hash.update(url.slice(ROOT.href.length)).update('\0').update(readFileSync(new URL(url))).update('\0');
  return hash.digest('hex');
}
const { generateWitness } = await import('../../../scripts/witness-generation.mjs');
const mode = process.argv.at(2) ?? 'all', fingerprint = inputs();
let checkpointResult;
if (mode !== 'fresh') {
  const generated = await generateWitness({ root: ROOT, slug: 'nine-dragon-stack', inputs: fingerprint, files: inputFiles(),
    manifest: new URL('checkpoints/manifest.json', import.meta.url), select: witness.setCheckpointDirectory,
    generate: async () => witness.writeCheckpoints(await witness.nineRapier(), fingerprint),
    record: mode === 'checkpoints', forceCompare: mode === 'checkpoints' || mode === 'compare-checkpoints', compare: !['checkpoints', 'cache-record'].includes(mode) });
  if (['checkpoints', 'cache-record', 'compare-checkpoints', 'cache-verify', 'checkpoint-directory'].includes(mode)) checkpointResult = { status: 'generated', inputs: fingerprint, directory: generated.directory, key: generated.key, hit: generated.hit, manifest: generated.manifest };
}

if (checkpointResult !== undefined) console.info(JSON.stringify(checkpointResult));
else if (mode === 'fresh') {
  const result = witness.checkpointsFresh(fingerprint);
  console.info(JSON.stringify(result)); process.exitCode = result.status === 'fresh' ? 0 : 1;

} else {
  if (!['all', 'headless', 'replay', 'replay-ride', 'replay-crossing', 'ledger'].includes(mode)) throw new Error('Unknown compatibility proof mode');
  const rapier = await witness.nineRapier(), results = {};
  if (mode === 'all' || mode === 'headless') results.headless = await witness.headlessProof(rapier);
  if (mode === 'all' || mode === 'replay') {
    const ride = await witness.replayProof(rapier, fingerprint, 'ride'), crossing = await witness.replayProof(rapier, fingerprint, 'crossing');
    results.replay = { status: ride.status === 'passed' && crossing.status === 'passed' ? 'passed' : 'failed', ride, crossing };
  } else if (mode === 'replay-ride' || mode === 'replay-crossing') results.replay = await witness.replayProof(rapier, fingerprint, mode === 'replay-ride' ? 'ride' : 'crossing');
  if (mode === 'all' || mode === 'ledger') Object.assign(results, await witness.ledgerProof(rapier));
  const passed = name => results[name]?.status === 'passed';
  const compatible = passed('headless') && passed('replay') && passed('ledger') && results.ledger?.gameplayEmissionProven === true;
  console.info(JSON.stringify({ slug: 'nine-dragon-stack', entry: witness.ENTRY, compatible, ...witness.SCOPE, ...results }));
  process.exitCode = compatible || passed(mode.startsWith('replay-') ? 'replay' : mode) ? 0 : 1;
}
