// oxlint-disable-next-line import/no-nodejs-modules -- Run the admitted quest composition on the shipped native physics module.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { creditNativeInventory,debitNativeInventory } from '../src/shared/game/inventoryLaw';
import { builtFolder,runtimeAssets } from './fixtures/engine-lift/folder';

test('a published quest restores its earned pack and physical props without granting stock or spawning twice', async () => {
  const directory = builtFolder('driftwood-isle'), product = await loadHeadlessFolder(directory);
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const input = { shard: product.shardfile, product, assets: runtimeAssets(product, directory), rapier };
  const first = await createNativeHeadlessResident(input);
  let next: Awaited<ReturnType<typeof createNativeHeadlessResident>> | undefined;
  try {
    expect(creditNativeInventory(first.host, 'pack', { item: 'doubloon', count: 4 })).toBe(true);
    first.step([]);
    const bodies = first.host.physics.world.bodies.len(), ids = [...first.host.entities.keys()];
    next = await createNativeHeadlessResident(input, snapshotSimHost(first.host));
    expect(next.effects).toEqual([]);
    expect(next.host.physics.world.bodies.len()).toBe(bodies);
    expect([...next.host.entities.keys()]).toEqual(ids);
    expect(debitNativeInventory(next.host, 'pack', { item: 'doubloon', count: 4 })).toBe(true);
    expect(debitNativeInventory(next.host, 'pack', { item: 'doubloon', count: 1 })).toBe(false);
    next.step([]);
    expect(next.host.physics.world.bodies.len()).toBe(bodies);
  } finally { next?.dispose(); first.dispose(); }
});
