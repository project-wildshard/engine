import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, DoubleSide, IcosahedronGeometry, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { TIER_CONFIG } from '@wildshard/engine/core/tier';
import { cullSlabRanges, slabRangesJob, SLAB_LEAF_TRIANGLES, visibleSlabDraws, type SlabDraws, type SlabRanges } from './slabRanges';
import { facedPart, faceParts, FACED_PART_LEAST, PART_FACING_GRID } from './partFacing';
import { Scope } from '@wildshard/engine/app/scope';

// NB8 (mini-nb8j): a made-up tree crown, as Nine's banyan core: lumps of small triangles facing every way within a few
// metres, in a scrambled order, about 12 m up and 30 m from a street camera.
function crown(lumps = 24): BufferGeometry {
  const positions: number[] = [], corners: number[] = [];
  for (let l = 0; l < lumps; l++) {
    const ball = new IcosahedronGeometry(1.5 + (l % 4) * 0.4, 6), at = positions.length / 3, p = ball.getAttribute('position');
    const cx = (l * 37 % 11) - 5, cy = 12 + (l * 13 % 5), cz = -30 + (l * 29 % 9) - 4;
    for (let v = 0; v < p.count; v++) positions.push(p.getX(v) + cx, p.getY(v) + cy, p.getZ(v) + cz);
    for (let v = 0; v < p.count; v++) corners.push(at + v);
    ball.dispose();
  }
  // scramble the triangles' order
  const triangles = corners.length / 3, order = Array.from({ length: triangles }, (_, t) => (t * 7919) % triangles), index: number[] = [];
  for (const t of order) index.push(corners[t * 3] ?? 0, corners[t * 3 + 1] ?? 0, corners[t * 3 + 2] ?? 0);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(index), 1));
  return geometry;
}
const run = (job: Generator<void, SlabRanges | null, void>): SlabRanges | null => { for (;;) { const step = job.next(); if (step.done === true) return step.value; } };
const street = (): PerspectiveCamera => {
  const view = new PerspectiveCamera(70, 402 / 874, 0.1, 2000);
  view.position.set(2, 1.7, 0); view.lookAt(0, 12, -30); view.updateMatrixWorld(true);
  return view;
};
const blank = (): SlabDraws => ({ starts: new Int32Array(4), counts: new Int32Array(4), n: 0, total: 0 });
/** the triangles of `geometry` that show `eye` their backs */
function backs(geometry: BufferGeometry, eye: Vector3): number {
  const index = geometry.index, position = geometry.getAttribute('position'); if (index === null) throw new Error('no index');
  let n = 0;
  for (let t = 0; t < index.count / 3; t++) {
    const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k))) as [Vector3, Vector3, Vector3];
    if (new Vector3().subVectors(a, eye).dot(new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))) > 0) n++;
  }
  return n;
}

test('a crown split by facing first, in finer cells, leaves out most of the triangles that face away; the slab split leaves out few', () => {
  const view = street(), world = new Matrix4();
  const slab = crown(), slabTree = run(slabRangesJob(slab, SLAB_LEAF_TRIANGLES, true));
  const part = crown(), partTree = run(slabRangesJob(part, SLAB_LEAF_TRIANGLES, true, Infinity, PART_FACING_GRID));
  if (slabTree === null || partTree === null) throw new Error('expected trees');
  const all = partTree.triangles, away = backs(part, view.position);
  expect(away).toBeGreaterThan(all * 0.4);
  const bySlab = visibleSlabDraws(slabTree, world, view, 0, blank(), true).total, byPart = visibleSlabDraws(partTree, world, view, 0, blank(), true).total;
  // every triangle facing the camera stays (the part's draws hold at least the fronts)
  expect(byPart).toBeGreaterThanOrEqual(all - away);
  expect(all - byPart).toBeGreaterThan(away * 0.6);
  expect(all - bySlab).toBeLessThan(away * 0.3);
});

test('the finer tree keeps every triangle once, and every triangle\'s normal lies in its leaf\'s cone', () => {
  const geometry = crown(6), before = Array.from(geometry.index?.array ?? []);
  const ranges = run(slabRangesJob(geometry, SLAB_LEAF_TRIANGLES, true, Infinity, PART_FACING_GRID));
  if (ranges === null || geometry.index === null) throw new Error('expected a tree');
  const key = (array: ArrayLike<number>): string[] => { const out: string[] = []; for (let t = 0; t < array.length / 3; t++) out.push(`${String(array[t * 3])},${String(array[t * 3 + 1])},${String(array[t * 3 + 2])}`); return out.sort(); };
  expect(key(geometry.index.array)).toEqual(key(before));
  const position = geometry.getAttribute('position'), index = geometry.index;
  for (let node = 0; node < ranges.nodes.length / 4; node++) {
    if ((ranges.nodes[node * 4] ?? -1) >= 0) continue;
    const axis = new Vector3(ranges.cones[node * 4] ?? 0, ranges.cones[node * 4 + 1] ?? 0, ranges.cones[node * 4 + 2] ?? 0), cos = ranges.cones[node * 4 + 3] ?? -1;
    for (let t = ranges.nodes[node * 4 + 2] ?? 0; t < (ranges.nodes[node * 4 + 3] ?? 0); t++) {
      const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k))) as [Vector3, Vector3, Vector3];
      expect(new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize().dot(axis)).toBeGreaterThanOrEqual(cos - 1e-6);
    }
  }
});

/** a renderer whose context records plain and multi draws of a plain mesh (`drawElements`) */
function fakeRenderer() {
  const calls: { kind: 'plain' | 'multi'; triangles: number }[] = [];
  const gl = {
    UNSIGNED_INT: 0x1405, UNSIGNED_SHORT: 0x1403,
    drawElementsInstanced: (_mode: number, count: number, _type: number, _offset: number, _instances: number): void => { calls.push({ kind: 'plain', triangles: count / 3 }); },
    drawElements: (_mode: number, count: number, _type: number, _offset: number): void => { calls.push({ kind: 'plain', triangles: count / 3 }); },
  };
  const extension = {
    multiDrawElementsInstancedWEBGL: (): void => { throw new Error('a plain mesh never draws instanced'); },
    multiDrawElementsWEBGL: (_mode: number, counts: Int32Array, _co: number, _type: number, _offsets: Int32Array, _oo: number, n: number): void => {
      let elements = 0; for (let i = 0; i < n; i++) elements += counts[i] ?? 0;
      calls.push({ kind: 'multi', triangles: elements / 3 });
    },
  };
  const renderer = { getContext: () => gl, info: { render: { frame: 0 } }, extensions: { has: (name: string) => name === 'WEBGL_multi_draw', get: () => extension } };
  // three's draw of a plain mesh: its draw range, one drawElements (none for an empty range), then onAfterRender
  const draw = (mesh: Mesh, view: PerspectiveCamera, fails = false): void => {
    const scene = new Scene(), { geometry } = mesh;
    mesh.onBeforeRender(renderer as never, scene, view, geometry, mesh.material as never, undefined as never);
    if (fails) return;
    const count = Math.min(geometry.drawRange.count, (geometry.index?.count ?? 0) - geometry.drawRange.start);
    if (count > 0) gl.drawElements(4, count, gl.UNSIGNED_INT, geometry.drawRange.start * 4);
    mesh.onAfterRender(renderer as never, scene, view, geometry, mesh.material as never, undefined as never);
  };
  return { calls, draw, gl };
}

test('a plain mesh with `single` multi-draws its front leaves in one call, and its range comes back whole', () => {
  const geometry = crown(), ranges = run(slabRangesJob(geometry, SLAB_LEAF_TRIANGLES, true, Infinity, PART_FACING_GRID));
  if (ranges === null) throw new Error('expected a tree');
  const mesh = new Mesh(geometry, new MeshBasicMaterial()), { calls, draw, gl } = fakeRenderer();
  mesh.updateMatrixWorld(true);
  cullSlabRanges(mesh, ranges, 0, { single: true, liveRange: true });
  draw(mesh, street());
  expect(calls).toHaveLength(1);
  expect(calls[0]?.kind).toBe('multi');
  expect(calls[0]?.triangles ?? Infinity).toBeLessThan(ranges.triangles * 0.8);
  expect([geometry.drawRange.start, geometry.drawRange.count]).toEqual([0, Infinity]);
  // disarmed: the same size again is a plain draw
  gl.drawElements(4, (calls[0]?.triangles ?? 0) * 3, gl.UNSIGNED_INT, 0);
  expect(calls[1]?.kind).toBe('plain');
});

test('a live range is read at each draw: an emptied range (its tile gone) draws nothing, a whole one is culled, and a draw that throws puts it back', () => {
  const geometry = crown(), ranges = run(slabRangesJob(geometry, SLAB_LEAF_TRIANGLES, true, Infinity, PART_FACING_GRID));
  if (ranges === null) throw new Error('expected a tree');
  const mesh = new Mesh(geometry, new MeshBasicMaterial()), { calls, draw } = fakeRenderer(), view = street();
  mesh.updateMatrixWorld(true);
  cullSlabRanges(mesh, ranges, 0, { single: true, liveRange: true });
  // the tile driver empties the range after the cull was installed
  geometry.setDrawRange(0, 0);
  draw(mesh, view);
  expect(calls).toHaveLength(0);
  expect([geometry.drawRange.start, geometry.drawRange.count]).toEqual([0, 0]);
  // the tile comes back: the whole index again
  geometry.setDrawRange(0, ranges.triangles * 3);
  draw(mesh, view, true);
  expect(geometry.drawRange.count).toBeLessThan(ranges.triangles * 3);
  // the next draw first puts back the range the failed one found, then culls it again
  draw(mesh, view);
  expect(calls.map(call => call.kind)).toEqual(['multi']);
  expect([geometry.drawRange.start, geometry.drawRange.count]).toEqual([0, ranges.triangles * 3]);
});

test('a part is faced only on the phone tier, front-sided, culled, big enough and inside one tile', async () => {
  const held = TIER_CONFIG.slabFacing;
  try {
  const at = (x: number, z: number): Matrix4 => new Matrix4().makeTranslation(x, 0, z);
  const geometry = crown(), mesh = new Mesh(geometry, new MeshBasicMaterial());
  expect(geometry.index !== null && geometry.index.count / 3 >= FACED_PART_LEAST).toBe(true);
  TIER_CONFIG.slabFacing = false;
  expect(facedPart(mesh, at(100, 100))).toBe(false);
  TIER_CONFIG.slabFacing = true;
  expect(facedPart(mesh, at(100, 100))).toBe(true);
  // a tile is 62.5 m: the crown (x -6.5 to 7.5) across x = 125 straddles two
  expect(facedPart(mesh, at(125, 100))).toBe(false);
  expect(facedPart(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })), at(100, 100))).toBe(false);
  const unculled = new Mesh(geometry, new MeshBasicMaterial()); unculled.frustumCulled = false;
  expect(facedPart(unculled, at(100, 100))).toBe(false);
  expect(facedPart(new Mesh(crown(1), new MeshBasicMaterial()), at(100, 100))).toBe(false);
  // faceParts builds one tree per geometry and draws the part by it
  const scope = new Scope('part-facing-test');
  await faceParts([mesh], scope);
  const { calls, draw } = fakeRenderer();
  mesh.updateMatrixWorld(true);
  draw(mesh, street());
  expect(calls[0]?.kind).toBe('multi');
  scope.dispose();
  } finally { TIER_CONFIG.slabFacing = held; }
});
