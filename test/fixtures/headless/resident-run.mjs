// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst.ts';
// The trusted resident (`createNativeProofResident`) in plain Node: the worker adapter's exact composition, its lent
// commands and per-lend effects, a strict object-continuation restore, and its admission as a GridSimulation region.
// oxlint-disable-next-line import/no-nodejs-modules -- Native assertions must fail the process.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the native physics module.
import { readFileSync } from 'node:fs';
import { createNativeProofAdapter, createNativeProofResident } from '../headless-native.ts';
import { prepareHeadlessRuntime } from './trustedRuntime.ts';
import { createShardProduct } from '../../../src/shared/game/shardfile/shardProduct.ts';
import { emptyShardfile } from '../../../src/shared/host/author.ts';
import { loadRapier } from '../../../src/shared/engine/physics/rapier.ts';
import { serializeSimSnapshot, snapshotSimHost } from '../../../src/shared/engine/sim/snapshot.ts';
import catalogue from '../../../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { GridAssembly } from '../../../src/shared/game/grid/assembly.ts';
import { GridSimulation } from '../../../src/server/game/grid/simulation.ts';
import { ResidencyAllocator } from '../../../src/shared/game/grid/allocator.ts';

const shard = emptyShardfile({ slug: 'trusted-fixture', name: 'Trusted fixture', author: 'Test', revision: 1, seed: 435 });
const rapier = await loadRapier(readFileSync(new URL('../../../public/assets/physics/rapier.wasm', import.meta.url)));
const product=createShardProduct({slug:shard.identity.slug,revision:shard.identity.revision,shardfile:shard,sections:new Map(),files:new Map(),read:()=>Promise.reject(new Error('No named files in direct fixture'))});
const preparation = { shard, product, assets: new Map(), rapier }, entry = prepareHeadlessRuntime;
const tape = tick => [{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0, ...(tick === 0 ? { attack: { targetId: 'fixture.actor' } } : {}) }, { kind: 'script', actorId: 'fixture.actor', value: tick }];
const wire = host => serializeSimSnapshot(snapshotSimHost(host));

// 1. The worker adapter is the resident: the same ticks give the same continuation and the same per-tick effects.
const adapter = await createNativeProofAdapter(preparation, entry), resident = await createNativeProofResident(preparation, entry);
let rewards = 0;
try {
  for (let tick = 0; tick < 30; tick++) {
    adapter.step(tape(tick)); resident.step(tape(tick));
    const commit = adapter.commit();
    assert.equal(commit.snapshot, wire(resident.host)); assert.deepEqual(commit.effects, resident.effects);
    rewards += resident.effects.length;
  }
  assert.equal(rewards, 1, 'the fixture pays once, on its 20th tick');
  assert.deepEqual(resident.host.slots.questState['numeric'], [29], 'the runtime reads the lent tick');
} finally { adapter.dispose(); }

// 2. Grid-style stepping: the owner lends, then steps the host itself; a lend opens a fresh effect buffer.
resident.lend([{ kind: 'script', actorId: 'fixture.actor', value: 99 }]); assert.equal(resident.effects.length, 0);
resident.host.step();
assert.deepEqual(resident.host.slots.questState['numeric'], [99]);

// 3. An object continuation restores exactly as its wire does (both strictly decoded), and both continue identically.
const saved = snapshotSimHost(resident.host), fromObject = await createNativeProofResident(preparation, entry, saved), fromWire = await createNativeProofResident(preparation, entry, serializeSimSnapshot(saved));
try {
  assert.equal(wire(fromObject.host), serializeSimSnapshot(saved));
  for (let tick = 0; tick < 10; tick++) { fromObject.step(tape(tick + 1)); fromWire.step(tape(tick + 1)); resident.step(tape(tick + 1)); }
  assert.equal(wire(fromObject.host), wire(fromWire.host)); assert.equal(wire(fromObject.host), wire(resident.host));
  await assert.rejects(createNativeProofResident(preparation, entry, { ...saved, version: -1 }));
} finally { fromObject.dispose(); fromWire.dispose(); resident.dispose(); }

// 4. A grid region: the lease precedes the world, the fence gates readiness, saves wait for durability, and the
//    controller's continuation (its tick counter) survives eviction and re-entry through the same entry.
const assembly = new GridAssembly({ developer: false, devserver: false }, { ...catalogue.grid,
  cells: catalogue.grid.cells.map(cell => ({ instance: `fixture-${cell.instance}`, slug: 'trusted-fixture', cell: cell.cell })), });
const instance = assembly.cells[0].instance, allocator = new ResidencyAllocator(), store = new Map();
let region, durable = false, admitted = false, loads = 0;
const counter = host => snapshotSimHost(host).adapters.find(row => row.id === 'fixture.controller')?.state;
const grid = new GridSimulation(assembly, { highway: await createNativeProofResident(preparation, entry), allocator, residentBytes: () => 1_000_000,
  admitted: () => admitted, read: id => store.get(id), save: (id, snapshot) => { if (!durable) return false; store.set(id, structuredClone(snapshot)); return true; },
  beforeMove: current => { if (current === instance) region.lend([{ kind: 'script', actorId: 'fixture.actor', value: 1 }]); },
  load: async (_cell, snapshot) => {
    assert.equal(allocator.has(`sim:${instance}`), true, 'reserve before native physics'); loads++;
    region = await createNativeProofResident(preparation, entry, snapshot); return region;
  } });
try {
  await grid.prefetch([instance]); assert.equal(grid.ready(instance), false); admitted = true; assert.equal(grid.ready(instance), true);
  (await grid.prepare(null, instance)).commit();
  for (let i = 0; i < 25; i++) grid.step();
  assert.equal(counter(region.host), 25); assert.deepEqual(region.host.slots.questState['numeric'], [1]);
  assert.equal(grid.checkpoint(instance), false); durable = true; assert.equal(grid.checkpoint(instance), true);
  (await grid.prepare(instance, null)).commit();
  const tick = region.host.state.tick; for (let i = 0; i < 5; i++) grid.step(); assert.equal(region.host.state.tick, tick);
  assert.equal(grid.unload(instance), true); assert.equal(allocator.has(`sim:${instance}`), false);
  (await grid.prepare(null, instance)).commit();
  assert.equal(counter(region.host), 25); assert.equal(region.host.state.tick, tick); assert.equal(loads, 2);
} finally { grid.dispose(); }
assert.equal(allocator.entries().length, 0);
console.info(JSON.stringify({ adapterExact: true, rewards, lent: true, objectRestore: true, refused: true, gridRegion: true, loads }));
