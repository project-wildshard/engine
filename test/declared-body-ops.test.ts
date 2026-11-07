// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual shipped native physics and restored handles.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { Scene } from 'three';
import { DeclaredBodyOpsSchema } from '@wildshard/format/bodySlots';
import { DeclaredBodyOps } from '../src/server/game/quest/bodyOps';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { AnimalHerdView } from '../src/client/engine/entities/AnimalHerdView';
import { RowBodies, type RowBodiesView } from '../src/client/engine/entities/RowBodies';
import { Animal } from '../src/client/engine/entities/AnimalView';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { activeLevel, configureLevel } from '../src/shared/engine/level/selection';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import type { ShardContext } from '../src/client/game/plugin/context';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { installKitWorldFixture } from './fixtures/kit-world';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

await installKitWorldFixture();

const rows = { bodies: [{ id: 'crate', kind: 'prop', at: { x: 2, y: 1, z: 3 }, yaw: .3,
  shape: { cuboid: { x: .4, y: .5, z: .6 } }, material: 'wood', owner: { kind: 'crate', id: 'crate' }, keep: true }],
  colliders: [{ id: 'crate.collider', target: { kind: 'body', body: 'crate' } }] };

test('declared transactions allocate only at commit, retain exact physics and refuse atomically', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const ops = await DeclaredBodyOps.install(host, rows), baseline = host.physics.world.bodies.len();
    const staged = ops.prepare([[17, 0, 1, 0, 0], [18, 1, 4, 5, 6], [19, 0, 1, 0, 0], [21, 1, 0, 0, 0]]);
    expect(host.physics.world.bodies.len()).toBe(baseline); expect(ops.body('crate')).toBeNull();
    expect(() => ops.prepare([[17, 0, 1, 0, 0], [19, 0, 999, 0, 0]])).toThrow('collider');
    expect(host.physics.world.bodies.len()).toBe(baseline);
    staged.commit(); const body = ops.body('crate'); if (body === null) throw new Error('Missing native prop');
    expect(host.physics.world.bodies.len()).toBe(baseline + 1);
    expect(body.rb.translation()).toEqual({ x: 4, y: 5, z: 6 }); expect(body.collider.isEnabled()).toBe(false);
    expect(ops.read(23, 1, 0)).toBe(1); expect(ops.read(25, 1, 0)).toBe(0);
    expect(() => staged.commit()).toThrow('no longer live');
    expect(() => ops.prepare([[18, 1, 20, 10, 20], [21, 1, 2, 0, 0]])).toThrow('visibility');
    expect(body.rb.translation()).toEqual({ x: 4, y: 5, z: 6 });
    ops.prepare([[20, 1, 7, 8, .7], [19, 0, 1, 1, 0]]).commit();
    expect(body.rb.translation()).toEqual({ x: 7, y: 5, z: 8 }); expect(ops.read(24, 1, 0)).toBe(.7);
    expect(body.rb.rotation().y).toBeCloseTo(Math.sin(.35));
    expect(body.collider.isEnabled()).toBe(true);
    ops.pre(1 / 60); host.physics.world.step(); ops.post(1 / 60);
    expect(ops.position('crate')?.y).toBeLessThan(5);
    ops.prepare([[22, 1, 0, 0, 0]]).commit(); expect(ops.body('crate')).toBeNull();
    expect(host.physics.world.bodies.len()).toBe(baseline);
    const pending = ops.prepare([[17, 0, 1, 0, 0]]); host.dispose();
    expect(() => pending.commit()).toThrow('no longer live');
  } finally { host.dispose(); }
});

test('caller-owned old save handles rebind without allocating or replaying scripts', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const ops = await DeclaredBodyOps.install(host, rows);
    ops.prepare([[17, 0, 1, 0, 0]]).commit();
    const handle = ops.body('crate')?.rb.handle;
    if (handle === undefined) throw new Error('Missing original handle');
    const saved = snapshotSimHost(host), restored = restoreSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier }, saved);
    try {
      const rebound = DeclaredBodyOps.native(restored, rows), before = restored.physics.world.bodies.len();
      rebound.restoreHandles({ crate: handle });
      expect(restored.physics.world.bodies.len()).toBe(before); expect(rebound.body('crate')?.rb.handle).toBe(handle);
      rebound.prepare([[18, 1, 3, 4, 5]]).commit(); expect(rebound.position('crate')).toEqual({ x: 3, y: 4, z: 5 });
      expect(() => rebound.restoreHandles({ crate: handle, foreign: handle })).toThrow('Unknown');
    } finally { restored.dispose(); }
  } finally { host.dispose(); }
});

test('rows are plain data and absent targets refuse before publishing any body', async () => {
  let accessed = false;
  const getter = { get bodies() { accessed = true; return []; }, colliders: [] };
  expect(() => v.parse(DeclaredBodyOpsSchema, getter)).toThrow('plain JSON'); expect(accessed).toBe(false);
  expect(() => v.parse(DeclaredBodyOpsSchema, { ...rows, bodies: [rows.bodies[0], rows.bodies[0]] })).toThrow();
  expect(() => v.parse(DeclaredBodyOpsSchema, { ...rows, colliders: [{ id: 'bad', target: { kind: 'body', body: 'absent' } }] })).toThrow();
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const baseline = host.physics.world.bodies.len();
    await expect(DeclaredBodyOps.install(host, { bodies: [], colliders: [{ id: 'missing', target: { kind: 'box', box: { x: 20, z: 20, hw: 1, hd: 1, yTop: 2, yBottom: 0 } } }] })).rejects.toThrow('baked box');
    expect(() => DeclaredBodyOps.native(host, { bodies: [{ id: 'guide', kind: 'actor', species: 'deer', variant: 'ghost', at: { x: 0, y: 0, z: 0 }, yaw: 0 }], colliders: [] })).toThrow('client-only');
    expect(host.physics.world.bodies.len()).toBe(baseline);
  } finally { host.dispose(); }
});

test('page actors are real native rigs, excluded from target lists and retired exactly once', async () => {
  const owner = new Scope('declared-guide'), previous = activeLevel();
  configureLevel({ ...previous, ground: { structures: true } });
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing native test services');
  const material = vi.spyOn(sky, 'setupMaterial').mockImplementation(() => undefined);
  const preloads = vi.spyOn(app.species, 'preloads').mockReturnValue([]);
  const manager = owner.run(() => new RowBodies(new AnimalHerdView(new Scene(), sky, { style: 'toon', render: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0, oneMaterial: true } }), app));
  const animals: RowBodiesView = manager, ctx = { scope: owner, app, game: { runtime: { play: { animals } } } } as ShardContext;
  const retire = vi.spyOn(manager, 'retire');
  try {
    const ops = await DeclaredBodyOps.install(ctx, { bodies: [{ id: 'guide', kind: 'actor', species: 'bear', variant: 'brown', at: { x: 1, y: 2, z: 3 }, yaw: .5 }], colliders: [] });
    expect(manager.animals).toHaveLength(0); expect(ops.actor('guide')).toBeNull();
    ops.prepare([[17, 0, 1, 0, 0], [20, 1, 4, 5, .8]]).commit();
    const actor = ops.actor('guide'); if (actor === null) throw new Error('Missing guide');
    expect(actor).toBeInstanceOf(Animal); expect(actor.variant).toBe('brown'); expect(actor.mesh.skeleton.bones.some(bone => bone.name === 'body')).toBe(true);
    expect(actor.position.toArray()).toEqual([4, 2, 5]); expect(manager.animals).not.toContain(actor);
    ops.prepare([[21, 1, 0, 0, 0]]).commit(); expect(actor.mesh.visible).toBe(false);
    ops.prepare([[21, 1, 1, 0, 0]]).commit(); expect(actor.mesh.visible).toBe(true);
    actor.setMotion(.9, 0, 3); actor.update(1 / 60, 1, true); expect(ops.position('guide')).toBe(actor.position);
    owner.dispose(); owner.dispose(); expect(retire).toHaveBeenCalledExactlyOnceWith(actor); expect(actor.mesh.parent).toBeNull();
  } finally { owner.dispose(); configureLevel(previous); material.mockRestore(); preloads.mockRestore(); retire.mockRestore(); }
});

test.each([true, false])('compiled AS body queries require granted floor capability: %s', async allowedFloor => {
  const { compileDecisionScripts } = await import('../src/sharddev/buildDecisionScripts');
  const { decisionBindingMap } = await import('@wildshard/format/decisionBindings');
  const { DecisionHost } = await import('../src/server/engine/script/decision');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const ops = await DeclaredBodyOps.install(host, { ...rows, floors: [{ x: 2, z: 3, step: 1, width: 1, height: 1, values: [6] }] });
    ops.setPlayerIntent({ x: 5, z: 7 });
    const input = { id: 'test.native-body', abi: '1.0', side: 'sim', module: `blobs/wasm/${'0'.repeat(64)}.wasm`, source: 'behaviour/body.as',
      binding: { shard: true }, onFail: 'hold', on: ['start'], reads: ['bodyAlive', 'playerIntent', 'declaredFloor'], commands: ['body.spawn', 'body.teleport'],
      bodies: { crate: 'crate' }, params: {}, state: [], stateVersion: 1 };
    const built = await compileDecisionScripts([input], ops.registries, new Map([['behaviour/body.as',
      "import {Body,Read,List,Do} from './generated/testNativeBody';\nexport function onStart():void{if(!Read.bodyAlive(Body.crate))Do.bodySpawn(Body.crate);Read.declaredFloor(2,3);const y=List.at(0);Do.bodyTeleport(Body.crate,Read.playerIntent(0),y,Read.playerIntent(1));}"]]), { asLineCeiling: 10 });
    const script = built.rows[0], blob = built.blobs[0]; if (script === undefined || blob === undefined) throw new Error('Missing compiled body program');
    const decision = new DecisionHost({ scripts: [{ ...script, reads: ['bodyAlive', 'playerIntent'], lists: allowedFloor ? ['declaredFloor'] : [], ids: decisionBindingMap(script, ops.registries).ids }],
      bindings: [{ id: 1, script: script.id, self: 0, actors: [], instance: 0 }], modules: new Map([[script.module, blob.bytes]]), seed: [1, 2],
      world: { read: (op, a, b) => ops.read(op, a, b), list: (op, a, b, out) => ops.list(op, a, b, out), prepare: commands => ops.prepare(commands), failed: () => undefined } });
    decision.enqueue(1, [1, 0, 0, 0, 0, 0]);
    for (let tick = 1; tick <= 6; tick++) decision.step(tick);
    expect(ops.body('crate')).toBeNull(); decision.step(7);
    expect(ops.position('crate')).toEqual(allowedFloor ? { x: 5, y: 6, z: 7 } : null);
    expect(decision.metrics()[0]?.refusals).toBe(allowedFloor ? 0 : 1);
  } finally { host.dispose(); }
});


test('intent samples remain requested motion and floors preserve captured null/bounds/max rules', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const ops = await DeclaredBodyOps.install(host, { ...rows, floors: [
      { x: 0, z: 0, step: 2, width: 2, height: 2, values: [3, null, -2, 7] },
      { x: 0, z: 0, step: 2, width: 1, height: 1, values: [5] },
    ] });
    expect(() => ops.read(26, 0, 0)).toThrow('unavailable');
    const requested = { x: 1.5, z: -2 }; const before = leadPlayer(host).position.clone();
    ops.setPlayerIntent(requested); requested.x = 0;
    expect(leadPlayer(host).position).toMatchObject(before);
    expect(ops.read(26, 0, 0)).toBe(1.5); expect(ops.read(26, 1, 0)).toBe(-2);
    expect(() => ops.read(26, 2, 0)).toThrow(); expect(() => ops.read(26, 0, 1)).toThrow();
    expect(() => ops.setPlayerIntent({ x: Infinity, z: 0 })).toThrow(); expect(ops.read(26, 0, 0)).toBe(1.5);
    expect(ops.floorAt(0, 0)).toBe(5); expect(ops.floorAt(2, 0)).toBe(0);
    expect(ops.floorAt(0, 2)).toBe(0); expect(ops.floorAt(2, 2)).toBe(7); expect(ops.floorAt(20, 20)).toBe(0);
    expect(ops.list(7, 0, 0, new Float64Array(0))).toBe(0);
    const result = new Float64Array(2); expect(ops.list(7, 0, 0, result)).toBe(1); expect(result[0]).toBe(5);
    expect(() => v.parse(DeclaredBodyOpsSchema, { ...rows, floors: [{ x: 0, z: 0, step: 1, width: 2, height: 2, values: [0] }] })).toThrow();
    ops.prepare([[17, 0, 1, 0, 0], [20, 1, 3, 4, 1.2], [18, 1, 2, 3, 4]]).commit();
    expect(ops.body('crate')?.rb.rotation().y).toBeCloseTo(Math.sin(.15));
    expect(ops.read(24, 1, 0)).toBe(.3);
  } finally { host.dispose(); }
});
