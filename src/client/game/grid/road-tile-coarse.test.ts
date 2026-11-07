import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshBasicMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { RingTile } from '@wildshard/engine/world/tileStreamer';
import { clipToBinsSteps, cullPlanSteps, finishRoadSteps, ROAD_LOD, type RoadCuller } from './roadCull';
import { coarseRoadTileSteps } from './roadTileCoarse';
import { compactRoadTileSteps } from './roadTileGeometry';
import { encodeRoadTile, decodeRoadTile } from './roadTileArchive';
import { RoadTilePool } from './roadTilePool';

function fixture(): { source: BufferGeometry; plan: ReturnType<typeof cullPlanSteps> } {
  const source = new BufferGeometry();
  source.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 125, 0, 0, 125, 0, 125, 0, 0, 125]), 3));
  source.setAttribute('uv', new BufferAttribute(Float32Array.from([0, 0, 125, 0, 125, 125, 0, 125]), 2));
  source.setIndex([0, 1, 2, 0, 2, 3]);
  finishRoadSteps(clipToBinsSteps(source, 562.5, 62.5));
  return { source, plan: cullPlanSteps(source, 562.5, ROAD_LOD, 62.5) };
}

test('coarse road backing preserves four independently maskable patch runs', () => {
  const { source, plan } = fixture(), finePlan = finishRoadSteps(plan);
  const coarse = finishRoadSteps(coarseRoadTileSteps(source, finePlan, 0, 0));
  expect(coarse.identity).toEqual({ x: 0, z: 0 }); expect(coarse.plan.lod).toEqual([]);
  expect(coarse.plan.bins).toHaveLength(4);
  expect(coarse.plan.bins.map(bin => bin.tile)).toEqual([{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: 1, z: 1 }]);
  const packed = encodeRoadTile(coarse), recovered = decodeRoadTile(packed);
  expect(recovered.identity).toEqual(coarse.identity);
  expect(recovered.plan.bins.map(bin => [bin.tile, bin.start, bin.count])).toEqual(coarse.plan.bins.map(bin => [bin.tile, bin.start, bin.count]));
  expect(Array.from(recovered.plan.source)).toEqual(Array.from(coarse.plan.source));
  expect(recovered.bytes).toEqual(coarse.bytes);
  source.dispose(); coarse.geometry.dispose(); recovered.geometry.dispose();
});

test('a fine child masks only its coarse quadrant without reallocating the parent draw', () => {
  const { source, plan } = fixture(), finePlan = finishRoadSteps(plan);
  const parent = finishRoadSteps(coarseRoadTileSteps(source, finePlan, 0, 0));
  const child = finishRoadSteps(compactRoadTileSteps(source, finePlan, 0, 0));
  const owner = new Scope('coarse road'), parentScope = owner.child('parent'), childScope = owner.child('child'), material = new MeshBasicMaterial();
  parentScope.own(parent.geometry); childScope.own(child.geometry);
  const culler: RoadCuller = { pitch: 562.5, tileSize: 62.5, plans: new Map() }, pool = new RoadTilePool(owner, material, culler, 'road');
  const parentTile: RingTile = { key: 'road:l1:0,0', instance: 'road', type: 'junction', level: 'l1', x: 0, z: 0 };
  const parentView = pool.publish(parentTile, parent, parentScope);
  pool.publish({ ...parentTile, key: 'road:l0:0,0', level: 'l0' }, child, childScope);
  const geometry = pool.mesh().geometry;
  parentView.mask(new Set([0]));
  const state = culler.plans.get(pool.mesh());
  expect(state?.bins.filter(bin => bin.visibility?.visible !== false)).toHaveLength(4);
  expect(state?.bins[0]?.visibility?.visible).toBe(false);
  expect(pool.mesh().geometry).toBe(geometry);
  childScope.dispose(); parentView.mask(new Set());
  expect(culler.plans.get(pool.mesh())?.bins.filter(bin => bin.visibility?.visible !== false)).toHaveLength(4);
  owner.dispose(); source.dispose(); material.dispose();
});

test('negative road coordinates retain the same parent and local quadrant mapping', () => {
  const { source, plan } = fixture(); source.translate(-125, 0, -125);
  const coarse = finishRoadSteps(coarseRoadTileSteps(source, finishRoadSteps(plan), -1, -1));
  expect(coarse.identity).toEqual({ x: -1, z: -1 });
  const quadrants = coarse.plan.bins.map(bin => {
    const tile = bin.tile; if (tile === undefined) throw new Error('Missing road patch');
    return tile.x + 2 + 2 * (tile.z + 2);
  }).sort((a, b) => a - b);
  expect(quadrants).toEqual([0, 1, 2, 3]);
  source.dispose(); coarse.geometry.dispose();
});
