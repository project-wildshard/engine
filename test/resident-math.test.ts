// oxlint-disable-next-line import/no-nodejs-modules -- A resident runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { portableMathInstalled } from '../src/shared/engine/core/portableMath';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

// A resident rolls its herds as it installs, on the Math a save will restore them on. This file takes no Math first, on purpose.
test('a resident is on the sim Math before it rolls anything', async () => {
  expect(portableMathInstalled(), 'nothing here installed it yet').toBe(false);
  const directory = builtFolder('pine-hollow'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const live = await createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, { room: true });
  try { expect(portableMathInstalled()).toBe(true); } finally { live.dispose(); }
});
