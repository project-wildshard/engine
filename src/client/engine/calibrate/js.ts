import * as THREE from 'three';
import { addTile, buildTile, createFindNearestPolyResult, createNavMesh, DEFAULT_QUERY_FILTER, findNearestPoly } from 'navcat';
import { calibrationBodies } from '../physics/calibration';
import { median } from './math';

export interface JsTiming { n: number; ms: number; samples: number[] }
function time(n: number, run: () => void): JsTiming {
  for (let i = 0; i < 10; i++) run();
  const samples = [];
  for (let i = 0; i < 7; i++) { const t = performance.now(); for (let k = 0; k < 32; k++) run(); samples.push((performance.now() - t) / 32); }
  return { n, ms: median(samples), samples };
}
export function syntheticNavigation(): ReturnType<typeof createNavMesh> {
  // A synthetic 64-poly navigation tile, never a level or its asset files.
  const nav = createNavMesh(), vertices: number[] = [], polys = [];
  nav.tileWidth = 8; nav.tileHeight = 8;
  for (let z = 0; z <= 8; z++) for (let x = 0; x <= 8; x++) vertices.push(x, 0, z);
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) { const id = z * 8 + x; polys.push({ vertices: [z * 9 + x, (z + 1) * 9 + x, (z + 1) * 9 + x + 1, z * 9 + x + 1], neis: [x > 0 ? id : 0, z < 7 ? id + 9 : 0, x < 7 ? id + 2 : 0, z > 0 ? id - 7 : 0], flags: 1, area: 0 }); }
  const detailTriangles = polys.flatMap(() => [0, 1, 2, 0, 0, 2, 3, 0]);
  const detailMeshes = polys.map((_, i) => ({ verticesBase: 0, verticesCount: 0, trianglesBase: i * 2, trianglesCount: 2 }));
  addTile(nav, buildTile({ bounds: [0, -1, 0, 8, 1, 8], vertices, polys, detailMeshes, detailVertices: [], detailTriangles, tileX: 0, tileY: 0, tileLayer: 0, cellSize: 1, cellHeight: 0.1, walkableHeight: 1.8, walkableRadius: 0.3, walkableClimb: 0.35 }));
  return nav;
}
export async function measureJs(): Promise<Record<'rig' | 'body' | 'agent', JsTiming[]>> {
  const rows: Record<'rig' | 'body' | 'agent', JsTiming[]> = { rig: [], body: [], agent: [] };
  const nav = syntheticNavigation();
  const nearest = createFindNearestPolyResult();
  if (!findNearestPoly(nearest, nav, [0.5, 0, 0.5], [1, 2, 1], DEFAULT_QUERY_FILTER).success) throw new Error('Synthetic navigation tile is not queryable');
  for (const n of [8, 32, 128]) {
    const rigs: { root: THREE.Bone; skeleton: THREE.Skeleton }[] = [];
    for (let i = 0; i < n; i++) { const root = new THREE.Bone(), bones = [root]; for (let j = 0; j < 15; j++) { const b = new THREE.Bone(); bones[j]?.add(b); bones.push(b); } rigs.push({ root, skeleton: new THREE.Skeleton(bones) }); }
    rows.rig.push(time(n, () => { for (const rig of rigs) { for (const [i, bone] of rig.skeleton.bones.entries()) bone.rotation.z += (i + 1) * 0.0001; rig.root.updateMatrixWorld(true); rig.skeleton.update(); } }));
    for (const rig of rigs) rig.skeleton.dispose();
    const bodies = await calibrationBodies(n);
    try { rows.body.push(time(n, bodies.run)); } finally { bodies.dispose(); }
    rows.agent.push(time(n, () => { for (let i = 0; i < n; i++) findNearestPoly(nearest, nav, [0.2 + (i % 8), 0, 0.2 + (Math.floor(i / 8) % 8)], [1, 2, 1], DEFAULT_QUERY_FILTER); }));
  }
  return rows;
}
