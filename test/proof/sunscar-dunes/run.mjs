// Signal Dunes' whole-shard witness in plain Node: no browser, DOM shim, renderer or active application.
// oxlint-disable-next-line import/no-nodejs-modules -- Fail the native witness if browser globals or an invalid proof mode are present.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Native proof mode and failure status are CLI results, not game configuration.
import process from 'node:process';
import { installAppIdentity } from '../../../src/shared/engine/app/identity.ts';
import { WILDSHARD_IDENTITY } from '../../../src/client/game/identity.ts';
import { ENTRY, signalRapier, headlessProof, replayProof, ledgerProof } from './witness.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
installAppIdentity(WILDSHARD_IDENTITY);
const mode = process.argv.at(2) ?? 'all';
const proofs = { headless: headlessProof, replay: replayProof, ledger: ledgerProof };
if (mode !== 'all' && !(mode in proofs)) throw new Error('Unknown compatibility proof mode');
const rapier = await signalRapier(), results = {};
for (const [name, proof] of Object.entries(proofs)) if (mode === 'all' || mode === name) results[name] = await proof(rapier);
const compatible = Object.keys(proofs).every(name => results[name]?.status === 'passed');
console.info(JSON.stringify({ slug: 'sunscar-dunes', entry: ENTRY, compatible, ...results }));
process.exitCode = compatible || (mode !== 'all' && results[mode]?.status === 'passed') ? 0 : 1;
