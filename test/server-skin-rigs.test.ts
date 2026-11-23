import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { serverReadsFile } from '@wildshard/format/serverReads';
import { serverSkinRigs } from '../src/shared/game/shardfile/serverSkinRigs';
import { creatureVolumeFixture } from './fixtures/creature-volume-skin';

// SHARD-SOURCE AP36c: engine 0.1.44 reads a spawned creature's skin rig on the server (its hit volumes and the giant height
// check), but a server read only bin, json, wasm and its terrain tile, so the page's own server worker and a cooked room
// refused the Template ("species boar: missing admitted skin GLB"). A server reads exactly the rigs its spawns need.
const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

/** The assets a server holds: what it reads of the product, as the worker, the headless folder and the cook choose it. */
function serverAssets(source: Awaited<ReturnType<typeof creatureVolumeFixture>>['source'], assets: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const rigs = serverSkinRigs(source);
  return new Map([...assets].filter(([ref]) => {
    const file = source.files.find(row => row.hash === ref);
    return file !== undefined && (serverReadsFile({ hash: file.hash, kind: file.kind === 'binary' ? 'bin' : file.kind }, source.terrain?.collider) || rigs.has(ref));
  }));
}

test('a server reads the skin rig of a spawned creature and opens its world', async () => {
  const { source, assets, file } = await creatureVolumeFixture();
  expect([...serverSkinRigs(source)]).toEqual([file]);
  const held = serverAssets(source, assets);
  expect(held.has(file)).toBe(true);
  const sim = createShardfileSim(source, held, { rapier: await rapier });
  sim.dispose();
});

test('a species nobody spawns, or a look that is no skin, reads no rig', async () => {
  const unspawned = await creatureVolumeFixture();
  unspawned.source.creatures.spawns.length = 0;
  expect(serverSkinRigs(unspawned.source).size).toBe(0);
  const drawn = await creatureVolumeFixture(), look = drawn.source.rows.looks.find(row => row.id === 'fixture.look');
  if (look === undefined) throw new Error('Missing fixture look');
  look.recipe = 'engine.sphere';
  expect(serverSkinRigs(drawn.source).size).toBe(0);
});
