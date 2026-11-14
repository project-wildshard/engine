// Plain Node grid admission through the built native plan or a direct typed proof factory (SF72 gridReady): the same
// GridAssembly / GridSimulation / ResidencyAllocator path the template's proof runs, with the cell's `load` composing the
// shard's trusted runtime exactly as the headless worker does (`createTrustedHeadlessResident`, @wildshard/engine/host/headlessRuntime).
// oxlint-disable-next-line import/no-nodejs-modules -- Native witness assertions must fail the process.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read immutable authored payloads, never a renderer.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare complete serialized region continuations.
import { createHash } from 'node:crypto';
import { TEMPLATE_SOURCE as template, templateAssets as readTemplateAssets } from '../../fixtures/templateSource.ts';
import catalogue from '../../../src/shared/game/grid/singleplayer.json' with { type: 'json' };
import { createShardfileSim } from '../../../src/server/game/plugin/simulation.ts';
import { loadRapier } from '../../../src/shared/engine/physics/rapier.ts';
import { snapshotSimHost } from '../../../src/shared/engine/sim/snapshot.ts';
import { installAppIdentity } from '../../../src/shared/engine/app/identity.ts';
import { WILDSHARD_IDENTITY } from '../../../src/client/game/identity.ts';
import { GridAssembly } from '../../../src/shared/game/grid/assembly.ts';
import { GridSimulation } from '../../../src/server/game/grid/simulation.ts';
import { ResidencyAllocator } from '../../../src/shared/game/grid/allocator.ts';
import { createTrustedHeadlessResident } from '../../../src/server/host/headlessRuntime.ts';
import { createNativeProofResident } from '../../fixtures/headless-native.ts';
import { leadPlayer } from '../../../src/shared/engine/sim/leadPlayer.ts';

/** The same catalogue grid is used in public and Developer modes (G972). */
const CATALOGUE_MODE = Object.freeze({ developer: false, devserver: false });
const ROOT = new URL('../../../', import.meta.url);
const bytes = (slug, hash) => new Uint8Array(readFileSync(new URL(`src/shards/${slug}/assets/${hash}`, ROOT)));
/** The active region's own continuation: its clock, bodies and every runtime controller (the traveller's body is the page's, not the region's). */
const regionDigest = (host) => {
  const { tick, entities, adapters } = snapshotSimHost(host);
  return createHash('sha256').update(JSON.stringify({ tick, entities, adapters: adapters.filter(row => !row.id.startsWith('runtime.actor.')) })).digest('hex');
};
/** A frozen region cannot snapshot (its motor is the traveller's); its clock and every body must still stand still. */
const bodies = (host) => JSON.stringify([host.state.tick, ...[...host.entities].map(([id, actor]) => [id, actor.alive, actor.hp, actor.position.x, actor.position.y, actor.position.z])]);

/**
 * Admit `source` through its native data plan or direct typed factory into its catalogue grid cell and walk the
 * template's readiness contract: one sim lease reserved before native physics, readiness false until the runtime fence
 * admits, `checkpoint` refused until durable, a frozen region while away, and the durable continuation restored on re-entry
 * through the same trusted entry. The template's door/script step (natives declare no script door) becomes play on the
 * region's own clock: a hurt creature, or a lent weapon swing where the region has no fauna (Nine Dragon Stack).
 */
export async function proveTrustedGridReady(source, mode = CATALOGUE_MODE, prepare = null, sourceAssets = null) {
  assert.equal(typeof document, 'undefined'); assert.equal(typeof window, 'undefined');
  installAppIdentity(WILDSHARD_IDENTITY);
  const slug = source.identity.slug;
  const rapier = await loadRapier(readFileSync(new URL('public/assets/physics/rapier.wasm', ROOT)));
  const assets = new Map(source.files.map(file => {
    const value = sourceAssets === null ? bytes(slug, file.hash) : sourceAssets.get(file.hash);
    assert.ok(value instanceof Uint8Array && value.byteLength === file.compressed, 'Source asset bytes must match their declared size');
    if (sourceAssets !== null) assert.equal(createHash('sha256').update(value).digest('hex'), file.hash);
    return [file.hash, value];
  }));
  const templateAssets = readTemplateAssets();
  const assembly = new GridAssembly(mode, catalogue.grid), instance = assembly.cells.find(cell => cell.slug === slug)?.instance;
  assert.equal(typeof instance, 'string', `${slug} has no catalogue grid cell in this mode`);
  const allocator = new ResidencyAllocator();
  const quest = { fact: () => { assert.fail('Readiness proof must not complete a quest'); }, coins: () => { assert.fail('Readiness proof must not grant coins'); } };
  const highway = createShardfileSim(template, templateAssets, { rapier, quest });
  let resident, durable = false, admitted = false, loads = 0, restored = 0, releaseAdmission;
  const admission = new Promise(resolve => { releaseAdmission = resolve; });
  const saved = new Map(); let tape = [];
  const grid = new GridSimulation(assembly, { highway, allocator, residentBytes: () => source.budgets.sim.resident,
    admitted: () => admitted, read: id => saved.get(id), save: (id, snapshot) => { if (!durable) return false; saved.set(id, structuredClone(snapshot)); return true; },
    beforeMove: (current) => { if (current === instance) resident.lend(tape); },
    load: async (cell, snapshot) => {
      await admission;
      assert.equal(cell.slug, slug);
      assert.equal(allocator.has(`sim:${instance}`), true, 'Reserve before creating native physics'); loads++;
      if (snapshot !== undefined) restored++;
      const { loadHeadlessFolder } = await import('../../../src/server/host/headlessFolder.ts');
      const product = await loadHeadlessFolder(`out/${slug}`);
      const preparation={shard:source,assets,rapier,product};
      if(product.has('sim/runtime-plan')) resident=await createTrustedHeadlessResident(preparation,snapshot);
      else {
        assert.equal(typeof prepare,'function','A native proof needs its direct typed factory');
        resident=await createNativeProofResident(preparation,prepare,snapshot);
      }
      assert.equal(resident.effects.length, 0, 'Admission emits no gameplay');
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
    assert.equal(grid.host(), resident.host);
    const [actorId, actor] = [...resident.host.entities].find(([, entity]) => entity.alive && entity.hp > 2) ?? [], admittedDigest = regionDigest(resident.host);
    // A region with fauna takes a hurt creature; one without (Nine) takes a lent weapon swing on its runtime's own controller.
    if (actor === undefined) tape = [{ kind: 'player', moveX: 0, moveZ: 0, yaw: leadPlayer(resident.host).yaw, attack: { targetId: 'grid-ready.swing' } }];
    else actor.applyFinalDamage(1, actor.position, actor.position);
    for (let i = 0; i < 4; i++) grid.step();
    tape = [];
    const hurt = actor?.hp; if (actor !== undefined) assert.ok(hurt < actor.maxHp);
    assert.notEqual(regionDigest(resident.host), admittedDigest, 'The region played');
    assert.equal(grid.checkpoint(instance), false); assert.equal(saved.size, 0);
    durable = true; assert.equal(grid.checkpoint(instance), true);
    const tick = resident.host.state.tick, digest = regionDigest(resident.host), effects = resident.effects.length;
    const leave = await grid.prepare(instance, null); leave.commit();
    const still = bodies(resident.host);
    for (let i = 0; i < 5; i++) grid.step();
    assert.equal(resident.host.state.tick, tick); assert.equal(bodies(resident.host), still, 'A region away from the traveller is frozen');
    assert.equal(grid.unload(instance), true);
    assert.equal(grid.ready(instance), false); assert.equal(allocator.has(`sim:${instance}`), false);
    const again = await grid.prepare(null, instance); again.commit();
    if (actor !== undefined) assert.equal(resident.host.entities.get(actorId)?.hp, hurt);
    assert.equal(resident.host.state.tick, tick); assert.equal(regionDigest(resident.host), digest, 'Re-entry restores the durable continuation');
    assert.equal(loads, 2); assert.equal(restored, 1);
    return { slug, instance, entry: typeof prepare==='function' ? 'direct native proof' : 'sim/runtime-plan', native: true, gridReady: true, reserveBeforePhysics: true, runtimeFence: true, refusedSave: true,
      restoredContinuation: true, played: actor === undefined ? 'swing' : 'hurt', ...(actor === undefined ? {} : { restoredHp: hurt }), frozenTicks: 5, loads, effects };
  } finally {
    grid.dispose();
    assert.equal(allocator.entries().length, 0);
  }
}
