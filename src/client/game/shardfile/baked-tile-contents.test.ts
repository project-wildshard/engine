import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import { bakedTileContents, type BakedTiles } from './bakedTiles';
import { tileKey } from './tileContent';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';

// Tile streaming T3: a baked set by tile. One small triangle at each of two spots in different tiles.
const key = (x: number, z: number): number => tileKey(tileOf(x, z));
const triangle = (x: number, z: number): number[] => [x, 0, z, x + 1, 0, z, x, 0, z + 1];
const mesh = (positions: number[], geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3))): Mesh => {
  const made = new Mesh(geometry, new MeshBasicMaterial()); made.matrixAutoUpdate = false; return made;
};

test('a baked set draws its resident tiles, keeps a shared geometry whole and moves its unclaimed colliders by tile', async () => {
  const resident = new Scope('baked'), registry = new WorldRegistry(), whole = resident.child('whole'), group = new Group();
  group.name = 'cove';
  const spread = mesh([...triangle(-200, -200), ...triangle(100, 150)]), shared = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.from(triangle(0, 0)), 3));
  spread.name = 'cove-tile';
  const colliders = [{ kind: 'box' as const, x: -200, y: 0, z: -200, hx: 1, hy: 1, hz: 1 }, { kind: 'box' as const, x: 100, y: 0, z: 150, hx: 1, hy: 1, hz: 1 }];
  const baked: BakedTiles = { group, tiles: [spread, mesh([], shared), mesh([], shared)], update: () => undefined,
    unclaimed: { piece: { name: 'rocks', category: 'nature', file: 'test', solidFloor: false }, id: 'cove-unclaimed', colliders, whole, registry } };
  const contents = bakedTileContents(baked);
  // the spread mesh and the colliders; the two meshes sharing one geometry stay whole
  expect(contents.map(content => content.id)).toEqual(['cove.cove-tile', 'cove-unclaimed.colliders']);
  expect(bakedTileContents(baked)).toEqual([]);
  expect(whole.disposed).toBe(true);
  const [render, ring] = contents;
  if (render === undefined || ring?.attachColliders === undefined) throw new Error('expected render and collider contents');
  expect(spread.geometry.drawRange.count).toBe(0);
  await render.attach(key(100, 150), resident.child('render'));
  expect(spread.geometry.drawRange.count).toBe(3);
  const tile = resident.child('colliders');
  await ring.attachColliders(key(-200, -200), tile);
  expect(registry.get(`cove-unclaimed.c${String(key(-200, -200))}`)?.colliders).toEqual([colliders[0]]);
  tile.dispose();
  expect(registry.get(`cove-unclaimed.c${String(key(-200, -200))}`)).toBeUndefined();
  resident.dispose();
});
