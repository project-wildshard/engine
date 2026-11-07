// oxlint-disable-next-line import/no-nodejs-modules -- verify the frozen shipping geometry oracle
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, type Object3D } from 'three';
import { WorldRegistry } from '../src/client/engine/world/registry';
import type { BossArenaRoom } from '../src/client/game/boss/arenaRoomView';
import { bossArena } from './fake/bossArena';
import { ShippingKurganDungeon } from './fixtures/kurgan-oracle/dungeon';
import { installWorldFixture } from './fixtures/worldSetup';

await installWorldFixture();

const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): string => JSON.stringify(value);

/** Hash actual attributes, indices and draw state; bounds are unused on these uncullable meshes. */
function meshes(group: Object3D): unknown[] {
  return group.children.map(object => {
    if (!(object instanceof Mesh)) throw new Error('The chamber must retain its flat mesh children');
    const geometry: unknown = object.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Missing chamber geometry');
    const attributes: unknown = geometry.attributes;
    if (typeof attributes !== 'object' || attributes === null) throw new Error('Missing chamber attributes');
    return { name: object.name, visible: object.visible, matrix: object.matrix.toArray(),
      position: object.position.toArray(), rotation: object.rotation.toArray(), scale: object.scale.toArray(),
      culled: object.frustumCulled, order: object.renderOrder,
      attributes: Object.keys(attributes).map(name => {
        const a: unknown = geometry.getAttribute(name);
        if (!(a instanceof BufferAttribute)) throw new Error('Expected ordinary chamber attributes');
        return [name, a.itemSize, a.count, a.normalized, a.usage,
          hash(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength))];
      }),
      index: geometry.index === null ? null : hash(new Uint8Array(geometry.index.array.buffer)),
    };
  });
}

function colliders(dungeon: BossArenaRoom | ShippingKurganDungeon): unknown {
  const registry = new WorldRegistry(); dungeon.register(registry);
  return registry.pieceList().map(piece => ({ id: piece.id, surface: piece.surface,
    solidFloor: piece.solidFloor, colliders: piece.colliders, active: piece.active?.() ?? true }));
}

function floors(dungeon: BossArenaRoom | ShippingKurganDungeon): string {
  const values: (number | null)[] = [];
  for (let x = -155; x <= 155; x++) for (let z = -110; z <= 240; z++) {
    values.push(dungeon.floorHeightAt(-40 + x / 10, -95 + z / 10) ?? null);
  }
  return hash(json(values));
}

test('baked Kurgan fabric preserves shipping geometry, lighting, colliders and sand', async () => {
  const shipping = new ShippingKurganDungeon().build();
  const baked = bossArena().build();
  expect(meshes(baked.group)).toEqual(meshes(shipping.group));
  expect(baked.tris).toBe(shipping.tris);
  expect(baked.colliders).toEqual(shipping.colliders);
  expect(colliders(baked)).toEqual(colliders(shipping));
  expect(floors(baked)).toBe(floors(shipping));

  const lazy = bossArena().build(true);
  expect(lazy.group.children.some(mesh => mesh.name === 'kurgan-interior')).toBe(false);
  await lazy.buildStaticSliced(() => Promise.resolve());
  expect(meshes(lazy.group)).toEqual(meshes(shipping.group));

  for (const dungeon of [shipping, baked, lazy]) {
    dungeon.setVisible(true); dungeon.setSealed(true); dungeon.setLid(0.83);
    dungeon.setNicheStatue(2, false); dungeon.setShaft(1, 1.2);
    dungeon.addSand(-5.2, 3.4, 3.2, 0.7); dungeon.addSand(0, -0.6, 2.2, 0.8);
    dungeon.update(0.1, 10); dungeon.showHeap(true);
  }
  expect(meshes(baked.group)).toEqual(meshes(shipping.group));
  expect(meshes(lazy.group)).toEqual(meshes(shipping.group));
  expect(colliders(baked)).toEqual(colliders(shipping));
  expect(floors(baked)).toBe(floors(shipping));
  for (const dungeon of [shipping, baked]) { dungeon.drainSand(0.7); dungeon.update(0.1, 11); }
  expect(meshes(baked.group)).toEqual(meshes(shipping.group));
  expect(floors(baked)).toBe(floors(shipping));
});
