// oxlint-disable-next-line import/no-nodejs-modules -- Use the shipped physics binary in the native gate regression.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Object3D } from 'three';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { addPiece, type AddedPiece } from '../src/shared/engine/physics/pieces';
import { createSimHost } from '../src/server/engine/sim';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { QuestState } from '../src/shared/engine/quest/core';
import { withOwner } from '../src/shared/engine/app/ownership';
import { QuestFlagGates } from '../src/shared/game/quest/flagGates';
import { publishBoundQuest } from '../src/shared/game/quest/boundState';
import type { ShardContext } from '../src/client/game/plugin/context';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const rows = { gates: [{ id: 'sluice', opensWhen: { all: ['open:sluice'] },
  target: { kind: 'box', box: { x: 8, z: 0, hw: .5, hd: .2, yTop: 3, yBottom: 0 } } }] };

test('native gates reuse exact baked collision, retain latches and rebind without replay', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    const collider = addPiece(host.physics, { id: 'sluice', name: 'Sluice', category: 'props', file: 'fixture',
      colliders: [{ kind: 'box', x: 8, y: 1.5, z: 0, hx: .5, hy: 1.5, hz: .2 }] }).colliders[0];
    if (collider === undefined) throw new Error('Missing original gate');
    const count = host.physics.world.colliders.len(), gate = new QuestFlagGates(host, rows);
    expect(host.physics.world.colliders.len()).toBe(count);
    host.flags.set('open:sluice'); expect(collider.isEnabled()).toBe(true);
    gate.sync(); expect(collider.isEnabled()).toBe(false);
    host.flags.clear('open:sluice'); gate.sync(); expect(collider.isEnabled()).toBe(false);
    const restored = new QuestFlagGates(host, rows, true);
    restored.physicsRestored(); expect(collider.isEnabled()).toBe(false);
    expect(host.physics.world.colliders.len()).toBe(count);
    expect(() => new QuestFlagGates(host, { gates: [rows.gates[0], rows.gates[0]] })).toThrow();
    expect(() => new QuestFlagGates(host, { gates: [{ id: 'absent', opensWhen: {}, target: { kind: 'box', box: { ...rows.gates[0]?.target.box, x: 90 } } }] })).toThrow('no baked collider');
  } finally { host.dispose(); }
});

test('page gates retain the original moving piece geometry, pose, flag owner and lifetime', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  const scope = host.scope.child('entered-quest'), registry = new WorldRegistry(), added: AddedPiece[] = [];
  registry.scope = scope;
  registry.onAdd(piece => { added.push(addPiece(host.physics, piece)); });
  const pivot = new Object3D(), colliders = [{ kind: 'box' as const, x: 0, y: 1, z: 0, hx: .5, hy: 1, hz: .1 }];
  withOwner(scope, () => { registry.add({ id: 'mill-door', name: 'Door', category: 'buildings', file: 'fixture', surface: 'wood', follows: pivot, colliders }); });
  const quest = new QuestState({ id: 'errand', title: 'Errand', completeFlag: 'complete', steps: [] }, host.flags, host.events, scope);
  publishBoundQuest(scope, quest);
  const ctx = { scope, game: { runtime: { world: { registry } } } } as ShardContext;
  const page = { quest: 'errand', gates: [{ id: 'mill-door-bar', name: 'Mill door bar', opensWhen: { all: ['errand:done'] }, target: { kind: 'piece', piece: 'mill-door' } }] };
  try {
    const before = host.physics.world.bodies.len();
    new QuestFlagGates(ctx, page);
    const bar = registry.get('mill-door-bar'), body = added[1];
    if (bar === undefined || body === undefined) throw new Error('Missing gate registration');
    expect(bar.follows).toBe(pivot); expect(bar.colliders).toBe(colliders);
    expect(host.physics.world.bodies.len()).toBe(before + 1);
    const collider = body.colliders[0]; if (collider === undefined) throw new Error('Missing gate collider');
    host.flags.set('errand:done'); body.sync(); expect(collider.isEnabled()).toBe(false);
    host.flags.clear('errand:done'); body.sync(); expect(collider.isEnabled()).toBe(true);
    expect(() => new QuestFlagGates(ctx, page)).toThrow('unique registered');
    expect(registry.pieceList()).toHaveLength(2);
    scope.dispose(); scope.dispose();
    expect(registry.pieceList()).toHaveLength(0);
    expect(host.physics.world.bodies.len()).toBe(before - 1);
  } finally { host.dispose(); }
});
