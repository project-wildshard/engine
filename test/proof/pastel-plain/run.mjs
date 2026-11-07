// Strict plain Node witness: no browser, DOM shim, renderer or active application.
// oxlint-disable-next-line import/no-nodejs-modules -- Fail the native witness if browser globals or an invalid proof mode are present.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Native proof mode is a command-line argument, never game configuration.
import { argv } from 'node:process';
import { pastelRapier, bootProof, headlessProof, replayProof, ledgerProof } from './fixture.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
const rapier = await pastelRapier();
const mode = argv.at(2) ?? 'all';
const proofs = { boot: bootProof, headless: headlessProof, replay: replayProof, ledger: ledgerProof };
const results = {};
for (const [name, proof] of Object.entries(proofs)) if (mode === 'all' || mode === name) results[name] = proof(rapier);
assert.notEqual(Object.keys(results).length, 0, 'Unknown proof name');
console.info(JSON.stringify(results));
