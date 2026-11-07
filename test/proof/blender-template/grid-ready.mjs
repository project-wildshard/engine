// Plain Node admission and durable regional continuation of the actual Blender project.
// oxlint-disable-next-line import/no-nodejs-modules -- Native witness assertions must fail the process.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read immutable authored payloads, never a renderer.
import { readFileSync } from 'node:fs';
import { readProjectAssets } from '../../../src/sharddev/project.ts';
import catalogue from '../../../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { createShardfileSim, bindShardfileSim } from '../../../src/server/game/plugin/simulation.ts';
import { loadRapier } from '../../../src/shared/engine/physics/rapier.ts';
import { restoreSimHost } from '../../../src/server/engine/sim/restore.ts';
import { GridAssembly } from '../../../src/shared/game/grid/assembly.ts';
import { GridSimulation } from '../../../src/server/game/grid/simulation.ts';
import { ResidencyAllocator } from '../../../src/shared/game/grid/allocator.ts';
import { leadPlayer } from '../../../src/shared/engine/sim/leadPlayer.ts';

assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const { shard: source, assets } = await readProjectAssets('src/shards/blender-template');
// This is an explicit regional-mechanism fixture, not a Developer placement in the shipped grid.
const assembly = new GridAssembly({ developer: false, devserver: false }, { ...catalogue.grid,
  cells: catalogue.grid.cells.map(cell => cell.cell[0] === -1 && cell.cell[1] === -1
    ? { instance: 'blender-template-proof', slug: 'blender-template', cell: cell.cell } : cell) });
const instance = assembly.cells.find((cell) => cell.slug === 'blender-template').instance, allocator = new ResidencyAllocator();
const quest = { fact: () => { assert.fail('Readiness proof must not complete a quest'); }, coins: () => { assert.fail('Readiness proof must not grant coins'); } };
const blender = () => createShardfileSim(source, assets, { rapier, quest });
const highway = blender(); let resident, durable = false, admitted = false, loads = 0;
let releaseAdmission;
const admission = new Promise((resolve) => { releaseAdmission = resolve; });
const saved = new Map();
const grid = new GridSimulation(assembly, { highway, allocator, residentBytes: () => source.budgets.sim.resident,
  admitted: () => admitted, read: (id) => saved.get(id), save: (id, snapshot) => { if (!durable) return false; saved.set(id, structuredClone(snapshot)); return true; },
  load: async (_cell, snapshot) => {
    await admission;
    assert.equal(allocator.has(`sim:${instance}`), true, 'Reserve before creating native physics'); loads++;
    resident = blender();
    if (snapshot !== undefined) {
      const level = resident.host.level; resident.dispose();
      const host = restoreSimHost(level, { rapier }, snapshot, (fresh) => { resident = bindShardfileSim(fresh, source, assets, { rapier, quest, restoring: true }); });
      assert.equal(resident.host, host);
    }
    return resident;
  },
});
try {
  assert.equal(grid.ready(instance), false);
  const pending = grid.prefetch([instance]); assert.equal(grid.ready(instance), false);
  releaseAdmission(); await pending;
  assert.equal(grid.ready(instance), false, 'Collider admission alone cannot satisfy runtime readiness');
  admitted = true; assert.equal(grid.ready(instance), true); assert.equal(loads, 1);
  const enter = await grid.prepare(null, instance); enter.commit();
  const actor = resident.host.entities.get('guardian.1'); actor.applyFinalDamage(5, actor.position, actor.position);
  resident.lane.enqueue({ type: 201, target: resident.actors.get(leadPlayer(resident.host).id), value: 1 });
  for (let i = 0; i < 4; i++) grid.step();
  assert.equal(resident.colliders.get('blender.door.collider').active(), false);
  assert.equal(grid.checkpoint(instance), false); assert.equal(saved.size, 0);
  durable = true; assert.equal(grid.checkpoint(instance), true);
  const hp = actor.hp, tick = resident.host.state.tick;
  const leave = await grid.prepare(instance, null); leave.commit();
  for (let i = 0; i < 5; i++) grid.step();
  assert.equal(resident.host.state.tick, tick); assert.equal(grid.unload(instance), true);
  assert.equal(grid.ready(instance), false); assert.equal(allocator.has(`sim:${instance}`), false);
  const again = await grid.prepare(null, instance); again.commit();
  assert.equal(resident.host.entities.get('guardian.1').hp, hp);
  assert.equal(resident.colliders.get('blender.door.collider').active(), false);
  assert.equal(resident.host.state.tick, tick); assert.equal(loads, 2);
  console.info(JSON.stringify({ native: true, gridReady: true, reserveBeforePhysics: true, runtimeFence: true, refusedSave: true, restoredDoor: true, restoredHp: hp, frozenTicks: 5, loads }));
} finally { grid.dispose(); }
assert.equal(allocator.entries().length, 0);
