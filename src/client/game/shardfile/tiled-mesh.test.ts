import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { tiledMesh } from './tiledMesh';
import { compactResident, tileKey, tileRanges } from './tileContent';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';

// Tile streaming T3: a merged recipe mesh keeps one draw; its index holds only the resident tiles' triangles. A made-up
// mesh with one small triangle at each of three spots, two of them in the same tile.
const spots: readonly (readonly [number, number])[] = [[-200, -200], [-190, -195], [100, 150]];
function made(): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from(spots.flatMap(([x, z]) => [x, 0, z, x + 1, 0, z, x, 0, z + 1])), 3));
  return new Mesh(geometry, new MeshBasicMaterial());
}
const key = (x: number, z: number): number => tileKey(tileOf(x, z));

test.each([false, true])('numeric centroids preserve exact tile draws against custom readers (wide index=%s)', wide => {
  const points = [-249.999, -187.5, -125.001, -62.5, -0, 0, 62.499, 125, 187.501, 249.999];
  const array = Float32Array.from(points.flatMap((x, i) => [x, i / 7, x, x + 0.003, -i, x, x, i / 3, x - 0.003]));
  const build = (custom: boolean): { mesh: Mesh; calls: () => number } => {
    const geometry = new BufferGeometry(), position = new BufferAttribute(array.slice(), 3);
    geometry.setAttribute('position', position);
    geometry.setIndex(new BufferAttribute(wide ? Uint32Array.from({ length: array.length / 3 }, (_, i) => i) : Uint16Array.from({ length: array.length / 3 }, (_, i) => i), 1));
    let calls = 0;
    if (custom) { const read = position.getX.bind(position); position.getX = i => { calls++; return read(i); }; }
    return { mesh: new Mesh(geometry, new MeshBasicMaterial()), calls: () => calls };
  };
  const fast = build(false), oracle = build(true), scope = new Scope('centroid oracle');
  const transform = new Matrix4().makeRotationY(0.37).premultiply(new Matrix4().makeTranslation(-17, 3, 41));
  const actual = tiledMesh('numeric', fast.mesh, transform), expected = tiledMesh('readers', oracle.mesh, transform);
  if (actual === null || expected === null) throw new Error('Expected multiple tiles');
  expect(oracle.calls()).toBe(array.length / 3);
  expect([...actual.tiles()]).toEqual([...expected.tiles()]);
  for (const tile of [...actual.tiles()].reverse()) {
    void actual.attach(tile, scope); void expected.attach(tile, scope);
    expect(fast.mesh.geometry.drawRange).toEqual(oracle.mesh.geometry.drawRange);
    expect(fast.mesh.geometry.index?.array).toEqual(oracle.mesh.geometry.index?.array);
  }
  scope.dispose(); expect(fast.mesh.geometry.drawRange).toEqual(oracle.mesh.geometry.drawRange);
  for (const { mesh } of [fast, oracle]) { mesh.geometry.dispose(); if (!Array.isArray(mesh.material)) mesh.material.dispose(); }
});

test.each(['array', 'getX'])('centroid guards do not invoke custom property readers (%s)', property => {
  const mesh = made(), position = mesh.geometry.getAttribute('position');
  const array = position.array, read = position.getX.bind(position);
  let calls = 0;
  Object.defineProperty(position, property, { configurable: true, get: () => { calls++; return property === 'array' ? array : read; } });
  expect(tiledMesh('custom property', mesh, new Matrix4())).not.toBeNull();
  expect(calls).toBe(property === 'array' ? 27 : 9);
  mesh.geometry.dispose(); if (!Array.isArray(mesh.material)) mesh.material.dispose();
});

test('a merged mesh draws only its resident tiles, one draw throughout', () => {
  const mesh = made(), content = tiledMesh('rocks.shore', mesh, new Matrix4()), scope = new Scope('tiles');
  if (content === null) throw new Error('expected a tiled mesh');
  const near = key(-200, -200), far = key(100, 150);
  expect([...content.tiles()].sort((a, b) => a - b)).toEqual([near, far].sort((a, b) => a - b));
  expect(mesh.geometry.drawRange.count).toBe(0);
  const nearScope = scope.child('near'), farScope = scope.child('far');
  void content.attach(far, farScope);
  expect(mesh.geometry.drawRange.count).toBe(3);
  expect(Array.from(mesh.geometry.index?.array.slice(0, 3) ?? [])).toEqual([6, 7, 8]);
  void content.attach(near, nearScope);
  expect(mesh.geometry.drawRange.count).toBe(9);
  farScope.dispose();
  expect(mesh.geometry.drawRange.count).toBe(6);
  expect(Array.from(mesh.geometry.index?.array.slice(0, 6) ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
  scope.dispose();
  expect(mesh.geometry.drawRange.count).toBe(0);
});

test('static content wholly in one tile follows that tile (a frozen weld mesh)', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([-200, 0, -200, -199, 0, -200, -200, 0, -199]), 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial()), scope = new Scope('weld');
  expect(tiledMesh('weld.hut', mesh, new Matrix4())).toBeNull();
  const content = tiledMesh('weld.hut', mesh, new Matrix4(), { single: true });
  if (content === null) throw new Error('expected a single-tile weld mesh');
  expect([...content.tiles()]).toEqual([key(-200, -200)]);
  expect(mesh.geometry.drawRange.count).toBe(0);
  const held = scope.child('tile');
  void content.attach(key(-200, -200), held);
  expect(mesh.geometry.drawRange.count).toBe(3);
  held.dispose();
  expect(mesh.geometry.drawRange.count).toBe(0);
  scope.dispose();
});

test('the cell transform places the triangles; a mesh in one tile stays whole', () => {
  const moved = tiledMesh('wreck.root', made(), new Matrix4().makeTranslation(50, 0, 0));
  expect(moved === null ? null : [...moved.tiles()].sort((a, b) => a - b)).toEqual([key(-150, -200), key(150, 150)].sort((a, b) => a - b));
  expect(key(-150, -200)).not.toBe(key(-200, -200));
  const one = new BufferGeometry();
  one.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  expect(tiledMesh('trolley', new Mesh(one, new MeshBasicMaterial()), new Matrix4())).toBeNull();
});

test('a mesh its scene never culls stays whole (a painted sky sphere kept on the eye)', () => {
  // Nine's sky: a 2 km sphere whose triangles clamped into the border tiles and drew nothing from the city's ring
  const sky = new Mesh(new SphereGeometry(2000, 16, 8), new MeshBasicMaterial());
  sky.frustumCulled = false;
  expect(tiledMesh('sky', sky, new Matrix4())).toBeNull();
  expect(sky.geometry.drawRange.count).toBe(Infinity);
  // the same sphere culled as usual is tiled like any merged mesh
  expect(tiledMesh('sphere', new Mesh(new SphereGeometry(2000, 16, 8), new MeshBasicMaterial()), new Matrix4())).not.toBeNull();
});

test('an instanced part draws only its resident tiles\' instances, every channel alike, one draw', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  const seeds = new InstancedBufferAttribute(Float32Array.from([10, 20, 30]), 1);
  geometry.setAttribute('aSeed', seeds);
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial(), 3);
  spots.forEach(([x, z], i) => { mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, z)); });
  const content = tiledMesh('palms', mesh, new Matrix4()), scope = new Scope('tiles');
  if (content === null) throw new Error('expected tiled instances');
  const near = key(-200, -200), far = key(100, 150), seed = (): number[] => Array.from(seeds.array.slice(0, mesh.count));
  expect(mesh.count).toBe(0);
  const farScope = scope.child('far'), nearScope = scope.child('near');
  void content.attach(far, farScope);
  expect(mesh.count).toBe(1); expect(seed()).toEqual([30]); expect(mesh.instanceMatrix.array[12]).toBe(100);
  void content.attach(near, nearScope);
  expect(mesh.count).toBe(3); expect(seed()).toEqual([10, 20, 30]);
  farScope.dispose();
  expect(mesh.count).toBe(2); expect(seed()).toEqual([10, 20]); expect(mesh.instanceMatrix.array[12]).toBe(-200);
  scope.dispose();
  expect(mesh.count).toBe(0);
  // its channels are dynamic: a GPU-only release (static attributes only) never drops their CPU copies
  expect(seeds.usage).toBe(DynamicDrawUsage); expect(mesh.instanceMatrix.usage).toBe(DynamicDrawUsage);
  // a part with a per-frame hook of its own (a culler owns its count) stays whole
  const culled = new InstancedMesh(geometry, new MeshBasicMaterial(), 3);
  spots.forEach(([x, z], i) => { culled.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, z)); });
  culled.onBeforeRender = () => undefined;
  expect(tiledMesh('culled', culled, new Matrix4())).toBeNull();
});

test('an instanced part whose channel holds fewer instances, or whose geometry another part compacts, stays whole', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(Float32Array.from([10, 20, 30]), 1));
  const place = (mesh: InstancedMesh): InstancedMesh => { spots.forEach(([x, z], i) => { mesh.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, z)); }); return mesh; };
  const first = place(new InstancedMesh(geometry, new MeshBasicMaterial(), 3)), second = place(new InstancedMesh(geometry, new MeshBasicMaterial(), 3));
  expect(tiledMesh('first', first, new Matrix4())).not.toBeNull();
  expect(tiledMesh('second', second, new Matrix4())).toBeNull();
  const short = new BufferGeometry();
  short.setAttribute('position', new BufferAttribute(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  short.setAttribute('aSeed', new InstancedBufferAttribute(Float32Array.from([10, 20]), 1));
  expect(tiledMesh('short', place(new InstancedMesh(short, new MeshBasicMaterial(), 3)), new Matrix4())).toBeNull();
});


test.each([false, true])('fused partition matches every original triangle ordinal (wide index=%s)', wide => {
  const positions = new Float32Array(512 * 9);
  for (let triangle = 0; triangle < 512; triangle++) {
    const x = (triangle % 8 - 4) * 62.5, z = (Math.floor(triangle / 8) % 8 - 4) * 62.5;
    // Exact edges, Float32 edge rounding and cancellation all use the original zero-first arithmetic.
    positions.set(triangle % 7 === 0 ? [2 ** 24, -0, z, -(2 ** 24), 0, z, x * 3, -0, z]
      : [x - .000001, triangle % 3, z, x + .000001, -1, z, x, 1, z + .000001], triangle * 9);
  }
  const source = wide ? Uint32Array.from({ length: 512 * 3 }, (_, i) => (i * 997) % (512 * 3))
    : Uint16Array.from({ length: 512 * 3 }, (_, i) => (i * 997) % (512 * 3));
  const geometry = new BufferGeometry(), position = new BufferAttribute(positions, 3), index = new BufferAttribute(source.slice(), 1);
  geometry.setAttribute('position', position); geometry.setIndex(index);
  const mesh = new Mesh(geometry, new MeshBasicMaterial()), transform = new Matrix4().set(
    1, .125, -.25, .000001, 0, 1, 0, 0, .25, -.125, 1, -.000001, 0, 0, 0, 1);
  const centres = new Float32Array(512 * 2), e = transform.elements;
  for (let t = 0; t < 512; t++) {
    let x = 0, y = 0, z = 0;
    for (let c = 0; c < 3; c++) { const v = index.getX(t * 3 + c); x += position.getX(v); y += position.getY(v); z += position.getZ(v); }
    x /= 3; y /= 3; z /= 3;
    centres[t * 2] = e[0] * x + e[4] * y + e[8] * z + e[12];
    centres[t * 2 + 1] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  const ranges = tileRanges(centres, 2, 0, 1), content = tiledMesh('full ordinal oracle', mesh, transform);
  if (content === null) throw new Error('Expected a partitioned mesh');
  const expected = source.slice(), resident = new Set<number>(), scope = new Scope('full ordinal oracle'), held = new Map<number, Scope>();
  const check = (): void => {
    const triangles = compactResident(ranges, resident, source, expected, 3);
    expect(geometry.drawRange.count).toBe(triangles * 3); expect(index.array).toEqual(expected);
  };
  const expectedTiles = Array.from(ranges.count, (count, tile) => count > 0 ? tile : -1).filter(tile => tile >= 0);
  expect([...content.tiles()]).toEqual(expectedTiles);
  try {
    check();
    for (const tile of [...expectedTiles].reverse()) {
      const owner = scope.child('tile'); held.set(tile, owner); resident.add(tile); void content.attach(tile, owner); check();
    }
    for (const tile of expectedTiles.filter((_, i) => i % 2 === 0)) { held.get(tile)?.dispose(); resident.delete(tile); check(); }
    for (const tile of resident) { held.get(tile)?.dispose(); resident.delete(tile); check(); }
    scope.dispose(); check();
  } finally { scope.dispose(); geometry.dispose(); mesh.material.dispose(); }
});
