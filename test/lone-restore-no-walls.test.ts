// oxlint-disable-next-line import/no-nodejs-modules -- The server half boots the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups } from '../src/shared/engine/physics/groups';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { isChunkEdgeWall } from '../src/shared/engine/physics/terrain';
import type { Physics } from '../src/shared/engine/physics/Physics';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { builtFolder, runtimeAssets } from './fixtures/engine-lift/folder';

// GRID-CROSSING GC36 (J322, no walls): a lone cell saved while lone cells had chunk-edge walls holds them in its saved world. Restored,
// they are taken out, so no invisible wall stands only on the server (the page builds none) and the next save drops them for good.
const walls = (physics: Physics): number => {
  let n = 0;
  physics.world.forEachCollider(c => { const h = c.halfExtents(), at = c.translation(); if (h !== null && isChunkEdgeWall([at.x, at.y, at.z], [h.x, h.y, h.z], c.rotation().w)) n++; });
  return n;
};
test.each(['driftwood-isle', '_template'])('a lone %s restored from a save with edge walls stands without them', { timeout: 120_000 }, async slug => {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const input = { shard, product, assets: runtimeAssets(product, directory), rapier }, options = () => ({ saves: new SaveStore({ local: null, session: null }), lone: true, wholeSolids: true, pageless: true });
  const old = await openCellWorld({ instance: slug }, input, undefined, options());
  // the four walls the retired `addEdgeWalls` put round a lone cell, the first one untagged as an older bake's
  const { R, world } = old.host.physics, reach = 250.2;
  for (const [x, z, hx, hz] of [[reach, 0, 1, 252], [-reach, 0, 1, 252], [0, reach, 252, 1], [0, -reach, 252, 1]] as const) {
    const c = world.createCollider(R.ColliderDesc.cuboid(hx, 230, hz).setTranslation(x, 170, z).setCollisionGroups(groups('WORLD')));
    if (x !== reach) tagCollider(c, 'edge');
  }
  expect(walls(old.host.physics)).toBe(4);
  const saved = snapshotSimHost(old.host); old.dispose();
  const restored = await openCellWorld({ instance: slug }, input, saved, options());
  try { expect(walls(restored.host.physics)).toBe(0); } finally { restored.dispose(); }
});
