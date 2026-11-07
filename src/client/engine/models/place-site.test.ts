// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { Box3, BoxGeometry, MeshStandardMaterial, Vector3 } from 'three';
import { defineModel, modelContext } from './model';
import { placeModelSite } from './place';
import { WorldRegistry } from '../world/registry';

test('a fixed model site lends its existing floor and translates the actual model, boxes and anchors once', () => {
  const material = new MeshStandardMaterial(), registry = new WorldRegistry(), context = modelContext(null);
  let builds = 0;
  const model = defineModel({ id: 'shared/site-fixture', name: 'Fixed site', category: 'buildings', pipeline: 'code', file: 'src/client/engine/models/place-site.test.ts', defaults: { width: 2 },
    build: (_ctx, params) => { builds++; return [{ geometry: new BoxGeometry(params.width, 2, 2), material }]; },
    colliders: (params) => [{ kind: 'box', x: 0, y: 1, z: 0, hx: params.width / 2, hy: 1, hz: 1, yaw: 0 }] });
  const origin = { x: 12, y: 5, z: -8 }, anchor = { x: 1, y: 2, z: 3, yaw: 0.7 };
  const layout = { anchors: { door: anchor }, colliders: [{ x: 0, z: 0, hw: 1, hd: 1, rot: 0, yTop: 2, yBottom: 0 }],
    floorHeightAt: (x: number, z: number): number | undefined => Math.abs(x) <= 1 && Math.abs(z) <= 1 ? 2 : undefined };
  const made = placeModelSite(model, origin, layout, { ctx: context, registry, piece: { id: 'fixed-site' } });
  expect(made.group).toBe(made.placed.object);
  expect(made.floorHeightAt(origin.x, origin.z)).toBe(7);
  expect(made.floorHeightAt(origin.x + 2, origin.z)).toBeUndefined();
  expect(registry.floorAt(origin.x, origin.z)).toBe(7);
  expect(made.anchors['door']).toMatchObject({ x: 13, y: 7, z: -5, yaw: anchor.yaw });
  expect(made.colliders[0]).toMatchObject({ x: origin.x, z: origin.z, yTop: 7, yBottom: 5 });
  expect(made.colliderDescs()).toEqual(made.placed.colliders);
  const bounds = made.placed.copyBox(0, new Box3());
  expect(bounds.containsPoint(new Vector3(origin.x, origin.y, origin.z))).toBe(true);
  const custom = placeModelSite(model, origin, layout, { ctx: context, registry: null, params: { width: 6 } });
  expect(custom.placed.copyBox(0, new Box3()).getSize(new Vector3()).x).toBe(6);
  expect(custom.colliderDescs()[0]).toMatchObject({ kind: 'box', hx: 3 });
  expect(made.colliderDescs()[0]).toMatchObject({ kind: 'box', hx: 1 });
  const prior = builds;
  expect(() => placeModelSite(model, { ...origin, y: Number.NaN }, layout, { ctx: context, registry })).toThrow();
  expect(() => placeModelSite(model, origin, { ...layout, anchors: { constructor: anchor } }, { ctx: context, registry })).toThrow();
  expect(builds).toBe(prior);
  material.dispose();
});
