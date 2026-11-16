import { expect, test } from 'vitest';
import { Box3, BufferAttribute, BufferGeometry, Frustum, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3, WebGLCoordinateSystem } from 'three';
import { cullSlabRanges, spatialSlabRanges, visibleSlabDraws, visibleSlabRun, SLAB_LEAF_TRIANGLES, type SlabDraws } from './slabRanges';

// NINE-DRAGON-BENCHMAX NB8: a made-up resident slab chunk, a 400 m street of small wall quads whose index is in a
// scrambled source order (as a resident cell's packing leaves it), drawn from a camera that sees one end of it.
function street(wide: boolean): BufferGeometry {
  const positions: number[] = [], corners: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const x = -200 + (i * 7919 % 1500) * 400 / 1500, z = (i % 3) * 6 - 6, y = (i % 5) * 4, at = positions.length / 3;
    positions.push(x, y, z, x + 0.25, y, z, x + 0.25, y + 3, z, x, y + 3, z);
    corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(wide ? Uint32Array.from(corners) : Uint16Array.from(corners), 1));
  return geometry;
}
const triangleKeys = (geometry: BufferGeometry): string[] => {
  const index = geometry.index; if (index === null) throw new Error('no index');
  const out: string[] = [];
  for (let t = 0; t < index.count / 3; t++) out.push([index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)].join(','));
  return out;
};
function camera(x: number, yaw: number): PerspectiveCamera {
  const view = new PerspectiveCamera(70, 402 / 874, 0.1, 2000);
  view.position.set(x, 1.7, 20); view.rotation.set(0, yaw, 0); view.updateMatrixWorld(true);
  return view;
}

test.each([false, true])('the k-d order keeps every triangle, each leaf box holds its own (wide index=%s)', wide => {
  const geometry = street(wide), before = triangleKeys(geometry).sort();
  const ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  expect(triangleKeys(geometry).sort()).toEqual(before);
  expect(ranges.triangles).toBe(3000);
  const index = geometry.index, position = geometry.getAttribute('position');
  if (index === null) throw new Error('no index');
  const point = new Vector3();
  for (let node = 0; node < ranges.nodes.length / 4; node++) {
    const box = new Box3().setFromArray(ranges.boxes.slice(node * 6, node * 6 + 6)), from = ranges.nodes[node * 4 + 2] ?? 0, to = ranges.nodes[node * 4 + 3] ?? 0;
    if ((ranges.nodes[node * 4] ?? -1) < 0) expect(to - from).toBeLessThanOrEqual(SLAB_LEAF_TRIANGLES);
    for (let t = from; t < to; t++) for (let k = 0; k < 3; k++) expect(box.containsPoint(point.fromBufferAttribute(position, index.getX(t * 3 + k)))).toBe(true);
  }
});

test('the visible run holds every triangle in view and leaves out the far end of the street', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const view = camera(-190, 0.1), world = new Matrix4().makeTranslation(3, 0, 0);
  const [start, end] = visibleSlabRun(ranges, world, view);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), WebGLCoordinateSystem);
  const index = geometry.index, position = geometry.getAttribute('position'); if (index === null) throw new Error('no index');
  let inView = 0;
  for (let t = 0; t < ranges.triangles; t++) {
    const box = new Box3(); for (let k = 0; k < 3; k++) box.expandByPoint(new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)).applyMatrix4(world));
    if (frustum.intersectsBox(box)) { inView++; expect(t >= start && t < end).toBe(true); }
  }
  expect(inView).toBeGreaterThan(0);
  expect(end - start).toBeLessThan(ranges.triangles / 2);
});

test('a chunk out of view still draws one leaf, so a warm builds its pipeline', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const [start, end] = visibleSlabRun(ranges, new Matrix4(), camera(0, Math.PI / 2 + Math.PI / 4));
  expect(end - start).toBeGreaterThan(0);
  expect(end - start).toBeLessThanOrEqual(SLAB_LEAF_TRIANGLES);
});

test('a draw takes the run and every other reader gets the whole chunk back', () => {
  const geometry = street(false), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), view = camera(-190, 0.1);
  cullSlabRanges(part, ranges);
  part.updateMatrixWorld(true);
  const scene = new Scene();
  part.onBeforeRender(undefined as never, scene, view, geometry, part.material, undefined as never);
  expect(geometry.drawRange.count).toBeLessThan(ranges.triangles * 3);
  expect(geometry.drawRange.count % 3).toBe(0);
  part.onAfterRender(undefined as never, scene, view, geometry, part.material, undefined as never);
  expect(geometry.drawRange.start).toBe(0);
  expect(geometry.drawRange.count).toBe(Infinity);
});

test('a chunk of one leaf keeps its order and no ranges', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9), 3)); geometry.setIndex([0, 1, 2]);
  expect(spatialSlabRanges(geometry)).toBeNull();
});

// NINE-DRAGON-BENCHMAX NB8 (mini-nb8d, mini-nb8g): the phone's size cut. The street again, beside each 25 cm wall quad a
// 3 m ledge strip 1 cm thick (a cable or a trim: a line on screen however thin, so it stays) and a 1 cm speck: from 30 m
// a speck is ~0.00047 rad long, under half the phone's 0.001 floor.
function ledgedStreet(): BufferGeometry {
  const positions: number[] = [], corners: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const x = -200 + (i * 7919 % 1500) * 400 / 1500, z = (i % 3) * 6 - 6, y = (i % 5) * 4;
    for (const [w, h, dy] of [[0.25, 3, 0], [3, 0.01, 3], [0.01, 0.01, 3.5]] as const) {
      const at = positions.length / 3;
      positions.push(x, y + dy, z, x + w, y + dy, z, x + w, y + dy + h, z, x, y + dy + h, z);
      corners.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(corners), 1));
  return geometry;
}
/** the phone tier's `slabLodAngle` (src/client/engine/render/tiers.ts; its desktop 0 is pinned in render/slab-tier.test.ts) */
const PHONE_ANGLE = 0.001;
const blankDraws = (): SlabDraws => ({ starts: new Int32Array(4), counts: new Int32Array(4), n: 0, total: 0 });
const drawn = (draws: SlabDraws): Set<number> => {
  const out = new Set<number>();
  for (let i = 0; i < draws.n; i++) for (let t = draws.starts[i] ?? 0, end = t + (draws.counts[i] ?? 0); t < end; t++) out.add(t);
  return out;
};

test('each leaf runs largest first, and a triangle\'s size is its longest edge', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  for (let node = 0; node < ranges.nodes.length / 4; node++) {
    if ((ranges.nodes[node * 4] ?? -1) >= 0) continue;
    for (let t = (ranges.nodes[node * 4 + 2] ?? 0) + 1; t < (ranges.nodes[node * 4 + 3] ?? 0); t++) expect(ranges.size[t] ?? 0).toBeLessThanOrEqual(ranges.size[t - 1] ?? 0);
  }
  const sizes = [...ranges.size].map(v => Math.round(v * 10000));
  expect(new Set(sizes)).toEqual(new Set([Math.hypot(0.25, 3), Math.hypot(3, 0.01), Math.hypot(0.01, 0.01)].map(v => Math.round(v * 10000))));
});

test('the phone draws every triangle in view at least angle × distance long, keeps every thin ledge, and leaves far specks out', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  // at the street's west end looking down it between two rows of walls: near ledges beside the camera, far ones to 400 m
  const view = camera(-199, -Math.PI / 2), world = new Matrix4().makeTranslation(3, 0, 0), angle = 0.001;
  view.position.z = 3; view.updateMatrixWorld(true);
  const draws = visibleSlabDraws(ranges, world, view, angle, blankDraws()), kept = drawn(draws);
  expect(kept.size).toBe(draws.total);
  const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse), WebGLCoordinateSystem);
  const index = geometry.index, position = geometry.getAttribute('position'); if (index === null) throw new Error('no index');
  let specks = 0, specksKept = 0, near = 0, ledges = 0;
  for (let t = 0; t < ranges.triangles; t++) {
    const box = new Box3(); for (let k = 0; k < 3; k++) box.expandByPoint(new Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)).applyMatrix4(world));
    if (!frustum.intersectsBox(box)) continue;
    const size = ranges.size[t] ?? 0, distance = box.distanceToPoint(view.position);
    if (size >= angle * distance) expect(kept.has(t)).toBe(true);
    // a ledge 1 cm thick and 3 m long draws as a line from anywhere in view: it is never cut (the thickness cut dropped them)
    if (size > 2 && box.max.y - box.min.y < 0.05) { ledges++; expect(kept.has(t)).toBe(true); }
    if (size < 0.05) { specks++; if (kept.has(t)) { specksKept++; if (distance < 14) near++; } }
  }
  // the ledges in view all stay; the specks within 14 m stay; most of the specks in view are past it and go
  expect(ledges).toBeGreaterThan(100);
  expect(near).toBeGreaterThan(0);
  expect(specksKept).toBeLessThan(specks / 2);
  const [start, end] = visibleSlabRun(ranges, world, view);
  expect(draws.total).toBeLessThan((end - start) * 0.75);
  // angle 0: every visible leaf whole, no more than the run
  const whole = visibleSlabDraws(ranges, world, view, 0, blankDraws());
  expect(whole.total).toBeLessThanOrEqual(end - start);
  expect(whole.total).toBeGreaterThan(draws.total);
});

/** a renderer as the slab draw sees one: its context records plain and multi draws, `multi` decides the extension */
function fakeRenderer(multi: boolean) {
  const calls: { kind: 'plain' | 'multi'; triangles: number; ranges: number }[] = [];
  class Context {
    readonly UNSIGNED_INT = 0x1405; readonly UNSIGNED_SHORT = 0x1403;
    drawElementsInstanced(_mode: number, count: number, _type: number, _offset: number, _instances: number): void { calls.push({ kind: 'plain', triangles: count / 3, ranges: 1 }); }
  }
  const gl = new Context();
  const extension = { multiDrawElementsInstancedWEBGL: (_mode: number, counts: Int32Array, _co: number, _type: number, _offsets: Int32Array, _oo: number, _instances: Int32Array, _io: number, n: number): void => {
    let elements = 0; for (let i = 0; i < n; i++) elements += counts[i] ?? 0;
    calls.push({ kind: 'multi', triangles: elements / 3, ranges: n });
  } };
  const info = { render: { frame: 0 } };
  const renderer = { getContext: () => gl, info, extensions: { has: (name: string) => multi && name === 'WEBGL_multi_draw', get: () => extension } };
  // three's draw of an instanced mesh: its draw range, one drawElementsInstanced, then onAfterRender
  const draw = (part: InstancedMesh, view: PerspectiveCamera): void => {
    const scene = new Scene(), { geometry } = part;
    part.onBeforeRender(renderer as never, scene, view, geometry, part.material as never, undefined as never);
    const count = Math.min(geometry.drawRange.count, (geometry.index?.count ?? 0) - geometry.drawRange.start);
    // three's renderInstances: no call for zero copies
    if (part.count > 0) gl.drawElementsInstanced(4, count, gl.UNSIGNED_INT, geometry.drawRange.start * 4, part.count);
    part.onAfterRender(renderer as never, scene, view, geometry, part.material as never, undefined as never);
  };
  return { gl, calls, draw, renderer, info, extension };
}

test('with multi-draw the phone angle draws fewer triangles in one call, and the context and range come back', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const view = camera(-190, 0.1), phone = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), { gl, calls, draw } = fakeRenderer(true);
  phone.updateMatrixWorld(true);
  cullSlabRanges(phone, ranges, PHONE_ANGLE);
  draw(phone, view);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.kind).toBe('multi');
  const [start, end] = visibleSlabRun(ranges, phone.matrixWorld, view);
  expect(calls[0]?.triangles ?? Infinity).toBeLessThan(end - start);
  expect(calls[0]?.ranges ?? 0).toBeGreaterThan(1);
  // disarmed after the draw: the same size again is a plain draw
  gl.drawElementsInstanced(4, (calls[0]?.triangles ?? 0) * 3, gl.UNSIGNED_INT, 0, 1);
  expect(calls[1]?.kind).toBe('plain');
  expect(geometry.drawRange.start).toBe(0);
  expect(geometry.drawRange.count).toBe(Infinity);
});

test('the desktop tier (angle 0), or a phone without multi-draw, draws the run exactly as before', () => {
  const view = camera(-190, 0.1);
  for (const [angle, multi] of [[0, true], [PHONE_ANGLE, false]] as const) {
    const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
    if (ranges === null) throw new Error('expected ranges');
    const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), { calls, draw } = fakeRenderer(multi);
    part.updateMatrixWorld(true);
    cullSlabRanges(part, ranges, angle);
    draw(part, view);
    const [start, end] = visibleSlabRun(ranges, part.matrixWorld, view);
    expect(calls).toEqual([{ kind: 'plain', triangles: end - start, ranges: 1 }]);
  }
});

test('a draw of another size while the swap waits passes through to the context', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), view = camera(-190, 0.1), { gl, calls } = fakeRenderer(true);
  part.updateMatrixWorld(true);
  cullSlabRanges(part, ranges, 0.001);
  const renderer = { getContext: () => gl, extensions: { has: () => true, get: () => ({ multiDrawElementsInstancedWEBGL: () => { calls.push({ kind: 'multi', triangles: 0, ranges: 0 }); } }) } };
  part.onBeforeRender(renderer as never, new Scene(), view, geometry, part.material, undefined as never);
  gl.drawElementsInstanced(4, 6, gl.UNSIGNED_INT, 0, 1);
  part.onAfterRender(renderer as never, new Scene(), view, geometry, part.material, undefined as never);
  expect(calls).toEqual([{ kind: 'plain', triangles: 2, ranges: 1 }]);
});

// mini-nb8e: the review of mini-nb8d's context patch
test('a draw that throws before onAfterRender leaves no swap for the next frame, and the next draw still multi-draws', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), view = camera(-190, 0.1), { gl, calls, draw, renderer, info } = fakeRenderer(true);
  part.updateMatrixWorld(true);
  cullSlabRanges(part, ranges, PHONE_ANGLE);
  // three throws between the part's onBeforeRender and its draw: no draw, no onAfterRender
  part.onBeforeRender(renderer as never, new Scene(), view, geometry, part.material, undefined as never);
  const armed = geometry.drawRange.count;
  // the next frame: another object's draw of exactly the armed size from offset 0 is its own plain draw
  info.render.frame++;
  gl.drawElementsInstanced(4, armed, gl.UNSIGNED_INT, 0, 1);
  expect(calls).toEqual([{ kind: 'plain', triangles: armed / 3, ranges: 1 }]);
  // and the part's own next draw multi-draws as before
  draw(part, view);
  expect(calls[1]?.kind).toBe('multi');
  gl.drawElementsInstanced(4, armed, gl.UNSIGNED_INT, 0, 1);
  expect(calls[2]?.kind).toBe('plain');
});

test('a restored context\'s new extensions object is read again, never the lost one', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), view = camera(-190, 0.1), { calls, draw, renderer } = fakeRenderer(true);
  part.updateMatrixWorld(true);
  cullSlabRanges(part, ranges, PHONE_ANGLE);
  draw(part, view);
  expect(calls[0]?.kind).toBe('multi');
  // three's initGLContext on a restore builds a new WebGLExtensions; this one has no multi-draw
  (renderer as { extensions: unknown }).extensions = { has: () => false, get: () => null };
  draw(part, view);
  const [start, end] = visibleSlabRun(ranges, part.matrixWorld, view);
  expect(calls[1]).toEqual({ kind: 'plain', triangles: end - start, ranges: 1 });
});

test('a plain mesh (drawn with drawElements) keeps the run, and a wrapper laid over the hook is wrapped in turn', () => {
  const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
  if (ranges === null) throw new Error('expected ranges');
  const view = camera(-190, 0.1), { gl, calls, draw } = fakeRenderer(true);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  cullSlabRanges(mesh, ranges, PHONE_ANGLE);
  mesh.onBeforeRender({ getContext: () => gl, extensions: { has: () => true, get: () => ({ multiDrawElementsInstancedWEBGL: () => { throw new Error('no multi-draw for a plain mesh'); } }) } } as never, new Scene(), view, geometry, mesh.material, undefined as never);
  const [start, end] = visibleSlabRun(ranges, mesh.matrixWorld, view);
  expect([geometry.drawRange.start / 3, geometry.drawRange.count / 3]).toEqual([start, end - start]);
  mesh.onAfterRender({} as never, new Scene(), view, geometry, mesh.material, undefined as never);
  const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1);
  part.updateMatrixWorld(true);
  cullSlabRanges(part, ranges, PHONE_ANGLE);
  draw(part, view);
  // a probe wraps the context's method after the hook: the next draw wraps the probe and still multi-draws
  const hooked: unknown = Reflect.get(gl, 'drawElementsInstanced'), seen: number[] = [];
  if (typeof hooked !== 'function') throw new Error('expected the hook');
  Reflect.set(gl, 'drawElementsInstanced', function drawElementsInstanced(this: unknown, ...args: number[]) { seen.push(args[1] ?? -1); Reflect.apply(hooked, this, args); });
  draw(part, view);
  // the armed draw became the multi-draw; any other draw reaches the probe, then the context
  gl.drawElementsInstanced(4, 6, gl.UNSIGNED_INT, 0, 1);
  expect(calls.map(call => call.kind)).toEqual(['multi', 'multi', 'plain']);
  expect(seen).toEqual([6]);
});

test('a chunk with nothing in view draws its first leaf once (the warm), then issues no draw until it is in view', () => {
  for (const multi of [true, false]) {
    const geometry = ledgedStreet(), ranges = spatialSlabRanges(geometry);
    if (ranges === null) throw new Error('expected ranges');
    const part = new InstancedMesh(geometry, new MeshBasicMaterial(), 1), { calls, draw } = fakeRenderer(multi);
    part.updateMatrixWorld(true);
    cullSlabRanges(part, ranges, PHONE_ANGLE);
    // the street runs along x at z -6 to 0; from z 20 looking away from it (+z) nothing is in view
    const away = camera(0, Math.PI);
    draw(part, away);
    expect(calls).toHaveLength(1);
    draw(part, away);
    expect(calls).toHaveLength(1);
    expect(part.count).toBe(1);
    draw(part, camera(-190, 0.1));
    expect(calls).toHaveLength(2);
  }
});
