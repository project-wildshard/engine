// oxlint-disable-next-line import/no-nodejs-modules -- Query the shipped native Rapier world.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Preserve complete native results and every snapshot byte.
import { deepStrictEqual } from 'node:assert';
import { expect, test, vi } from 'vitest';
import { RawVector } from '@dimforge/rapier3d-simd/raw.js';
import { Physics } from '../src/shared/engine/physics/Physics';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { groups, queryGroups } from '../src/shared/engine/physics/groups';

const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
async function fixture() {
  const R = await rapier, physics = new Physics(R), world = physics.world;
  world.createCollider(R.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0).setCollisionGroups(groups('WORLD')));
  world.createCollider(R.ColliderDesc.ball(1).setTranslation(2, 1, 0).setCollisionGroups(groups('WORLD')));
  const sensor = world.createCollider(R.ColliderDesc.cuboid(2, 0.1, 2).setTranslation(0, 3, 0).setSensor(true).setCollisionGroups(groups('WORLD')));
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(-3, 1, 0));
  world.createCollider(R.ColliderDesc.cuboid(1, 0.2, 1).setCollisionGroups(groups('WORLD')), body);
  physics.step(); return { R, physics, world, sensor, body };
}

test('4096 native casts retain every detached hit/normal/feature, filter and complete world byte', async () => {
  const f = await fixture(), saved = f.physics.snapshot();
  const ray = new f.R.Ray({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 });
  try {
    const kept = f.physics.castRayAndGetNormal(ray, 20, true), copy = kept === null ? null : {
      time: kept.timeOfImpact, normal: { ...kept.normal }, feature: kept.featureType, id: kept.featureId, collider: kept.collider,
    };
    expect(kept).not.toBeNull();
    for (let i = 0; i < 2048; i++) {
      ray.origin.x = Math.sin(i * 0.31) * 13; ray.origin.y = i % 5 === 0 ? 0 : 7; ray.origin.z = Math.cos(i * 0.17) * 4;
      ray.dir.x = Math.sin(i * 0.13) * 0.1; ray.dir.y = i % 7 === 0 ? 0 : -1; ray.dir.z = 0;
      const flags = i % 3 === 0 ? undefined : i % 3 === 1 ? f.R.QueryFilterFlags.EXCLUDE_SENSORS : f.R.QueryFilterFlags.ONLY_FIXED;
      const mask = i % 11 === 0 ? undefined : queryGroups(['WORLD']);
      const collider = i % 5 === 0 ? f.sensor : undefined, body = i % 7 === 0 ? f.body : undefined;
      const distance = i % 13 === 0 ? 0 : 20, solid = i % 2 === 0;
      deepStrictEqual(f.physics.castRay(ray, distance, solid, flags, mask, collider, body), f.world.castRay(ray, distance, solid, flags, mask, collider, body));
      deepStrictEqual(f.physics.castRayAndGetNormal(ray, distance, solid, flags, mask, collider, body), f.world.castRayAndGetNormal(ray, distance, solid, flags, mask, collider, body));
    }
    deepStrictEqual(f.physics.snapshot(), saved);
    if (kept === null || copy === null) throw new Error('Missing original detached query result');
    deepStrictEqual({ time: kept.timeOfImpact, normal: { ...kept.normal }, feature: kept.featureType, id: kept.featureId, collider: kept.collider }, copy);
    const calls: number[][] = [];
    for (const scratch of [false, true]) {
      const handles: number[] = [], predicate = (collider: typeof f.sensor): boolean => { handles.push(collider.handle); return collider !== f.sensor; };
      const cast = scratch ? f.physics.castRayAndGetNormal.bind(f.physics) : f.world.castRayAndGetNormal.bind(f.world);
      ray.origin.x = 0; ray.origin.y = 7; ray.origin.z = 0; ray.dir.x = 0; ray.dir.y = -1;
      const hit = cast(ray, 20, true, undefined, undefined, undefined, undefined, predicate);
      expect(hit?.collider).not.toBe(f.sensor); calls.push(handles);
    }
    expect(calls[1]).toEqual(calls[0]);
  } finally { f.physics.dispose(); }
});

test('explicit normal output retains every native value and identity without changing detached defaults', async () => {
  const f = await fixture(), ray = new f.R.Ray({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 });
  try {
    const target = f.physics.castRayAndGetNormal(ray, 20, true);
    if (target === null) throw new Error('Missing real native output target');
    const normal = target.normal, saved = f.physics.snapshot();
    let hits = 0, misses = 0;
    for (let i = 0; i < 2048; i++) {
      ray.origin.x = Math.sin(i * .31) * 13; ray.origin.y = 7; ray.origin.z = Math.cos(i * .17) * 4;
      const prior: { collider: typeof f.sensor; time: number; normal: { x: number; y: number; z: number }; feature: number; id: number | undefined }
        = { collider: target.collider, time: target.timeOfImpact, normal: { ...normal }, feature: target.featureType, id: target.featureId };
      const baseline = f.world.castRayAndGetNormal(ray, 20, i % 2 === 0, f.R.QueryFilterFlags.EXCLUDE_SENSORS);
      const hit = f.physics.castRayAndGetNormal(ray, 20, i % 2 === 0, f.R.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined, undefined, undefined, undefined, target);
      deepStrictEqual(hit, baseline);
      if (hit === null) {
        misses++;
        deepStrictEqual({ collider: target.collider, time: target.timeOfImpact, normal: { ...normal }, feature: target.featureType, id: target.featureId }, prior);
      } else {
        hits++; expect(hit).toBe(target); expect(hit.normal).toBe(normal);
        const detached = f.physics.castRayAndGetNormal(ray, 20, i % 2 === 0, f.R.QueryFilterFlags.EXCLUDE_SENSORS);
        deepStrictEqual(detached, hit); expect(detached).not.toBe(target); expect(detached?.normal).not.toBe(normal);
      }
    }
    expect(hits).toBeGreaterThan(0); expect(misses).toBeGreaterThan(0); deepStrictEqual(f.physics.snapshot(), saved);
  } finally { f.physics.dispose(); }
});

test('seven nested coordinate reads retain original order/results and explicitly release bounded native scratch', async () => {
  const f = await fixture(), freed = vi.spyOn(RawVector.prototype, 'free');
  const run = (scratch: boolean, fail = false) => {
    let depth = 0; const log: string[] = [], hits: unknown[] = [];
    const cast = scratch ? f.physics.castRayAndGetNormal.bind(f.physics) : f.world.castRayAndGetNormal.bind(f.world);
    const direction = { get x() { log.push(`dx:${String(depth)}`); return 0; }, get y() { log.push(`dy:${String(depth)}`); return -1; }, get z() { log.push(`dz:${String(depth)}`); return 0; } };
    const origin = { get x() {
      log.push(`x:${String(depth)}`);
      if (fail && depth === 5) throw new Error('Original coordinate refusal');
      if (depth < 6) { depth++; try { const hit = cast(new f.R.Ray(origin, direction), 20, true); hits.push(hit === null ? null : [hit.collider.handle, hit.timeOfImpact, { ...hit.normal }, hit.featureType, hit.featureId]); } finally { depth--; } }
      return 0;
    }, get y() { log.push(`y:${String(depth)}`); return 7; }, get z() { log.push(`z:${String(depth)}`); return 0; } };
    if (fail) expect(() => { cast(new f.R.Ray(origin, direction), 20, true); }).toThrow('Original coordinate refusal');
    else cast(new f.R.Ray(origin, direction), 20, true);
    return { log, hits };
  };
  let disposed = false;
  try {
    deepStrictEqual(run(true), run(false));
    deepStrictEqual(run(true, true), run(false, true));
    deepStrictEqual(run(true), run(false));
    const count = freed.mock.calls.length; f.physics.dispose(); disposed = true;
    // Eight retained ray vectors plus the separately owned native-step gravity vector.
    expect(freed.mock.calls.length - count).toBe(9);
    const ray = new f.R.Ray({ x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 });
    expect(() => f.physics.castRay(ray, 20, true)).toThrow('Cannot query a disposed physics world');
    expect(() => f.physics.castRayAndGetNormal(ray, 20, true)).toThrow('Cannot query a disposed physics world');
  } finally { if (!disposed) f.physics.dispose(); freed.mockRestore(); }
});

test('a throwing native collider predicate retains its exact original outcome and recovery', async () => {
  const f = await fixture(), error = new Error('Original predicate refusal');
  const ray = new f.R.Ray({ x: 0, y: 7, z: 0 }, { x: 0, y: -1, z: 0 });
  const run = (scratch: boolean) => {
    let calls = 0, failure: unknown;
    let hit: ReturnType<typeof f.physics.castRayAndGetNormal> = null;
    const predicate = (): boolean => { calls++; throw error; };
    try {
      hit = scratch ? f.physics.castRayAndGetNormal(ray, 20, true, undefined, undefined, undefined, undefined, predicate)
        : f.world.castRayAndGetNormal(ray, 20, true, undefined, undefined, undefined, undefined, predicate);
    } catch (caught) { failure = caught; }
    expect(calls).toBeGreaterThan(0);
    return { hit, failure, calls };
  };
  try {
    deepStrictEqual(run(true), run(false));
    deepStrictEqual(f.physics.castRayAndGetNormal(ray, 20, true), f.world.castRayAndGetNormal(ray, 20, true));
  } finally { f.physics.dispose(); }
});
