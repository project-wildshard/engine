// Pine Hollow's witness tape in plain Node (no browser, DOM shim, renderer or active application): the day's legs, Hale's
// watch, the Ghost Stag's walk and the Antler King's fight, by tick commands alone (witness.ts):
//   node --import ./scripts/sim-node-loader.mjs test/proof/pine-hollow/tape.mjs
// run.mjs owns the canonical recorded/checkpointed witness. This CLI diagnoses the full command tape.
// oxlint-disable-next-line import/no-nodejs-modules -- Fail the native witness if browser globals are present.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- The tape's status is the CLI result.
import process from 'node:process';
import { installAppIdentity } from '../../../src/shared/engine/app/identity.ts';
import { WILDSHARD_IDENTITY } from '../../../src/client/game/identity.ts';
import { ENTRY, pineRapier, tapeProof } from './witness.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
installAppIdentity(WILDSHARD_IDENTITY);
const result = await tapeProof(await pineRapier());
console.info(JSON.stringify({ slug: 'pine-hollow', entry: ENTRY, tape: result }));
process.exitCode = result.status === 'failed' ? 1 : 0;
