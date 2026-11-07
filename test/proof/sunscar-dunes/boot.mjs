// Signal Dunes boots in plain Node through its declared trusted headless factory, as the shipping worker composes it.
// oxlint-disable-next-line import/no-nodejs-modules -- Native boot assertions must fail the process.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the shard's admitted in-tree bytes and the native physics module.
import { readFileSync } from 'node:fs';
import { source, sourceAssets } from '../../fixtures/sunscar-source-program.ts';
import { loadRapier } from '../../../src/shared/engine/physics/rapier.ts';
import { decodeSimSnapshot } from '../../../src/shared/engine/sim/snapshot.ts';
import { installAppIdentity } from '../../../src/shared/engine/app/identity.ts';
import { WILDSHARD_IDENTITY } from '../../../src/client/game/identity.ts';
import { createTrustedHeadlessAdapter } from '../../../src/server/host/headlessRuntime.ts';
import { loadHeadlessProduct } from '../../../src/server/host/headlessProduct.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
installAppIdentity(WILDSHARD_IDENTITY);
const root = new URL('../../../', import.meta.url);
const rapier = await loadRapier(readFileSync(new URL('public/assets/physics/rapier.wasm', root)));
const assets = sourceAssets;
// The same verified built runtime plan as the shipping worker, without a shard module URL.
const adapter = await createTrustedHeadlessAdapter({ shard: source, assets, rapier, product: await loadHeadlessProduct('out/sunscar-dunes') });
try {
  adapter.step([]);
  const commit = adapter.commit(), snapshot = decodeSimSnapshot(commit.snapshot);
  const homes = snapshot.entities.map((entity) => entity.id), steps = snapshot.adapters.map((entry) => entry.id).filter((id) => !id.startsWith('runtime.actor.'));
  assert.deepEqual(homes, source.runtime?.spawns?.homes.map((home) => home.id));
  assert.equal(commit.effects.length, 0);
  console.info(JSON.stringify({ native: true, tick: commit.tick, homes: homes.length, steps, terrain: source.terrain !== null, effects: commit.effects.length }));
} finally { adapter.dispose(); }
