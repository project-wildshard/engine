// oxlint-disable-next-line import/no-nodejs-modules -- The unit host uses the same native physics module as the resident.
import { installBodyScripts } from '@wildshard/engine/game/shardfile/nativeRuntimeLoans';
import type { HeadlessRuntimePlan } from '@wildshard/engine/host/headlessRuntime';
import { readFileSync } from 'node:fs';
import { beforeAll,expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { trustedLevel } from '../src/server/game/plugin/simulation';
import { hasStaticGround } from '../src/shared/engine/physics/query';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { onSimHostRestored,snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

/** Typed fixture composition retains native contracts independently of the retiring DSL. */
function directPlan(shard: ReturnType<typeof emptyShardfile>, install: HeadlessRuntimePlan['install']): HeadlessRuntimePlan {
  return { level: trustedLevel(shard, {at:{x:shard.spawn.x,y:Math.max(shard.spawn.y,.1),z:shard.spawn.z},yaw:shard.spawn.yaw,speed:5}, {size:500,height:0}),
    ports:{ground:false,heightAt:()=>0},install };
}

test('refuses native body scripts before real ground admission or after its host ends', () => {
  const shard = emptyShardfile({ slug: 'native-ground', name: 'Native Ground', author: 'Test', revision: 1, seed: 1 });
  const product = createShardFolder({ slug: 'native-ground', revision: 1, shardfile: shard, sections: new Map(),
    files: new Map(),
    read: () => Promise.reject(new Error('Direct body proof reads sections only')) });
  const plan = directPlan(shard, (host, context) => installBodyScripts(host, context, {product,assets:new Map()}));
  const host = createSimHost(plan.level, { ...plan.ports, rapier });
  const context = { restoring: false, commands: () => [], emit: () => undefined };
  try {
    const before = snapshotSimHost(host);
    expect(() => plan.install(host, context)).toThrow('require admitted ground');
    expect(snapshotSimHost(host)).toEqual(before);
    // A disabled floor, a sensor and a dynamic ground-tagged body do not
    // establish the static collision admission this capability requires.
    const physics = host.physics;
    const moving = physics.world.createRigidBody(physics.R.RigidBodyDesc.dynamic());
    const falseGround = [
      physics.world.createCollider(physics.R.ColliderDesc.cuboid(1, 1, 1).setEnabled(false)),
      physics.world.createCollider(physics.R.ColliderDesc.cuboid(1, 1, 1).setSensor(true)),
      physics.world.createCollider(physics.R.ColliderDesc.cuboid(1, 1, 1), moving),
    ];
    for (const collider of falseGround) tagCollider(collider, 'ground');
    const unready = snapshotSimHost(host);
    expect(() => plan.install(host, context)).toThrow('require admitted ground');
    expect(snapshotSimHost(host)).toEqual(unready);
  } finally { host.dispose(); }
  expect(() => plan.install(host, context)).toThrow('owner has ended');
});

test('native restore checks the restored ground before releasing the host', () => {
  const shard = emptyShardfile({ slug: 'native-restore-ground', name: 'Restore Ground', author: 'Test', revision: 1, seed: 1 });
  const product = createShardFolder({ slug: shard.identity.slug, revision: 1, shardfile: shard,
    sections: new Map<string, unknown>([['sim/scripts', []], ['sim/bodies', {}]]),
    files: new Map(),
    read: () => Promise.reject(new Error('Direct body proof reads sections only')) });
  const plan = directPlan(shard, (host, context) => installBodyScripts(host, context, {product,assets:new Map()}));
  const source = createSimHost(plan.level, { rapier }), empty = createSimHost(plan.level, { ...plan.ports, rapier });
  const ports = { ...plan.ports, rapier };
  const context = { restoring: true, commands: () => [], emit: () => undefined };
  try {
    const saved = snapshotSimHost(source);
    const restored = restoreSimHost(plan.level, ports, saved, host => {
      expect(hasStaticGround(host.physics)).toBe(false);
      plan.install(host, context);
    });
    try {
      expect(hasStaticGround(restored.physics)).toBe(true);
      expect(snapshotSimHost(restored)).toEqual(saved);
      expect(() => onSimHostRestored(restored, () => undefined)).toThrow('not restoring');
    } finally { restored.dispose(); }
    expect(() => restoreSimHost(plan.level, ports, snapshotSimHost(empty), host => { plan.install(host, context); })).toThrow('require admitted ground');
    expect(() => plan.install(empty, context)).toThrow('not restoring');
  } finally { source.dispose(); empty.dispose(); }
});
