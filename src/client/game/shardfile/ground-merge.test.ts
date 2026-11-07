import { expect, test } from 'vitest';
import * as THREE from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { GroundMerge } from './groundMerge';

// Tile streaming P1 (draws): a splat ground's resident tiles draw as one merged mesh per material; a coarse tile leaves out
// the quadrants its fine tiles cover, and the merge follows its members' tile scopes.
const settle = (): Promise<void> => new Promise(resolve => { queueMicrotask(resolve); });
function tile(x: number, z: number): THREE.Mesh {
  // two triangles: one in the tile's -x -z quadrant, one in its +x +z quadrant (a coarse tile is 125 m from (x, z))
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x + 1, 0, z + 1, x + 2, 0, z + 1, x + 1, 0, z + 2, x + 100, 0, z + 100, x + 101, 0, z + 100, x + 100, 0, z + 101], 3));
  g.setAttribute('splat', new THREE.Float32BufferAttribute(Array.from({ length: 24 }, () => 0.25), 4));
  g.setIndex([0, 2, 1, 3, 5, 4]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

test('fine tiles draw as one mesh; tiles leave with their scopes; the last takes the mesh', async () => {
  const parent = new THREE.Group(), material = new THREE.MeshBasicMaterial(), merge = new GroundMerge(parent, material, 'ground.fine');
  const a = new Scope('a'), b = new Scope('b'), ta = tile(-250, -250), tb = tile(-125, -250);
  merge.add(ta, a); merge.add(tb, b); await settle();
  expect([ta.visible, tb.visible]).toEqual([false, false]);
  expect(parent.children).toHaveLength(1);
  const merged = merge.mesh; if (merged === null) throw new Error('no merged mesh');
  expect(merged.material).toBe(material);
  expect(merged.geometry.getIndex()?.count).toBe(12);
  expect(Object.keys(merged.geometry.attributes).sort()).toEqual(['position', 'splat']);
  a.dispose(); await settle();
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(6);
  b.dispose(); await settle();
  expect(merge.mesh).toBeNull(); expect(parent.children).toHaveLength(0);
});

test('a coarse tile leaves out the quadrants fine tiles cover', async () => {
  const parent = new THREE.Group(), merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground.coarse'), scope = new Scope('c');
  const hide = merge.add(tile(-250, -250), scope, { x: 0, z: 0 }); await settle();
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(6);
  expect(merge.mesh?.userData['coarseTiles']).toEqual([{ x: 0, z: 0, visible: true }]);
  hide(new Set([0])); await settle();                      // the -x -z quadrant: its triangle goes
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(3);
  expect(merge.mesh?.userData['coarseTiles']).toEqual([{ x: 0, z: 0, visible: true }]);
  hide(new Set([0, 1, 2, 3])); await settle();             // all four: the tile draws nothing
  expect(merge.mesh).toBeNull();
  scope.dispose();
});

test('tiles draw one mesh per 250 m block; a change rebuilds only its block', async () => {
  const parent = new THREE.Group(), merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground.fine');
  const a = new Scope('a'), b = new Scope('b'), c = new Scope('c');
  merge.add(tile(-250, -250), a); merge.add(tile(10, -250), b); await settle();
  expect(merge.meshes).toHaveLength(2); expect(parent.children).toHaveLength(2);
  const [west, east] = merge.meshes;
  merge.add(tile(-125, -250), c); await settle();                // joins the west block
  expect(merge.meshes).toHaveLength(2);
  expect(merge.meshes).toContain(east);                           // the east block kept its mesh
  expect(merge.meshes).not.toContain(west);
  expect(merge.meshes.map(mesh => mesh.geometry.getIndex()?.count ?? 0).sort((x, y) => x - y)).toEqual([6, 12]);
  b.dispose(); await settle();
  expect(merge.meshes).toHaveLength(1); expect(merge.size).toBe(2);
  a.dispose(); c.dispose(); await settle();
  expect(merge.meshes).toHaveLength(0); expect(parent.children).toHaveLength(0);
});

test('FC16: ring tiles prepared in their own groups merge under the shared root once published, not before', async () => {
  const root = new THREE.Group(), merge = new GroundMerge(root, new THREE.MeshBasicMaterial(), 'ground.fine');
  const a = new Scope('a'), b = new Scope('b'), ga = new THREE.Group(), gb = new THREE.Group(), ta = tile(-250, -250), tb = tile(-125, -250);
  ga.add(ta); gb.add(tb);
  merge.add(ta, a); merge.add(tb, b); await settle();
  expect(ta.visible).toBe(false);
  expect(merge.meshes).toHaveLength(0);                              // prepared, not published: nothing draws yet
  gb.position.set(0, 3, 0); root.add(gb);                            // published: it joins at once, at its transform
  expect(merge.meshes).toHaveLength(1);
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(6);
  expect(merge.mesh?.geometry.getAttribute('position').getY(0)).toBe(3);
  root.add(ga); await settle();                                      // the second tile joins the same block: one draw
  expect(merge.meshes).toHaveLength(1);
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(12);
  b.dispose(); await settle();
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(6);
  const c = new Scope('c'), gc = new THREE.Group(), tc = tile(-250, -125); gc.add(tc);
  merge.add(tc, c); c.dispose(); root.add(gc); await settle();       // retired before it was published: never joins
  expect(merge.mesh?.geometry.getIndex()?.count).toBe(6);
  a.dispose(); await settle();
  expect(merge.meshes).toHaveLength(0);
});

test('detached painted tiles stay cell-local after their region moves and rebuilds', async () => {
  const parent = new THREE.Group(), scope = new Scope('painted region');
  const merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground');
  const coarse = tile(-250, -250), hide = merge.add(coarse, scope, { x: 0, z: 0 });
  await settle();
  try {
    parent.position.set(562.5, 40, -562.5);
    // The aerial camera moves the fine ring: its changed cover rebuilds the
    // permanent coarse ground after the regional root acquired its grid pose.
    hide(new Set([3])); await settle();
    const mesh = merge.mesh;
    if (mesh === null) throw new Error('Missing coarse ground');
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual(Array.from(coarse.geometry.getAttribute('position').array));
    expect(mesh.geometry.getIndex()?.count).toBe(3);
    mesh.updateWorldMatrix(true, false);
    expect(new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), 0).applyMatrix4(mesh.matrixWorld).toArray()).toEqual([313.5, 40, -811.5]);
    // A later detached fine tile belongs to the same cell-local block.
    const fine = tile(-125, -250); fine.position.set(5, 2, 3);
    merge.add(fine, scope); await settle();
    expect(merge.meshes).toHaveLength(1);
    expect(merge.mesh?.geometry.getIndex()?.count).toBe(9);
    const position = merge.mesh?.geometry.getAttribute('position');
    if (position === undefined) throw new Error('Missing merged vertices');
    expect(new THREE.Vector3().fromBufferAttribute(position, 6).toArray()).toEqual([-119, 2, -246]);
  } finally { scope.dispose(); await settle(); }
  expect(parent.children).toHaveLength(0);
});

test('attached ground retains its nested transform across grid rebasing', async () => {
  const parent = new THREE.Group(), nested = new THREE.Group(), scope = new Scope('nested ground');
  parent.position.set(562.5, 0, -562.5); parent.add(nested); nested.position.set(10, 2, 20);
  const source = tile(-250, -250); nested.add(source);
  const merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground');
  merge.add(source, scope); await settle();
  try {
    const before = Array.from(merge.mesh?.geometry.getAttribute('position').array ?? []);
    expect(before.slice(0, 3)).toEqual([-239, 2, -229]);
    parent.position.set(-562.5, 0, 562.5); merge.rebuild();
    expect(Array.from(merge.mesh?.geometry.getAttribute('position').array ?? [])).toEqual(before);
  } finally { scope.dispose(); await settle(); }
});

// G782: a block's bounds come from its members' kept bounds: the same box as three computes over the merged positions, and
// a sphere that holds every vertex; a member that leaves takes its bounds with it.
test('merged bounds are the union of the drawn members bounds', async () => {
  const parent = new THREE.Group(), merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground.bounds');
  const a = new Scope('a'), b = new Scope('b');
  merge.add(tile(-250, -250), a); merge.add(tile(-125, -200), b); await settle();
  const check = (): void => {
    const geometry = merge.mesh?.geometry; if (geometry === undefined) throw new Error('no merged mesh');
    const box = geometry.boundingBox, sphere = geometry.boundingSphere, position = geometry.getAttribute('position');
    if (box === null || sphere === null) throw new Error('merged bounds missing');
    if (!(position instanceof THREE.BufferAttribute)) throw new Error('merged positions are a plain attribute');
    expect(box.equals(new THREE.Box3().setFromBufferAttribute(position))).toBe(true);
    for (let i = 0; i < position.count; i++) expect(sphere.containsPoint(new THREE.Vector3().fromBufferAttribute(position, i))).toBe(true);
  };
  check();
  a.dispose(); await settle();
  check();
  b.dispose();
});

test('T10: merged attributes read as three reads them, plain, interleaved, normalized or half float', async () => {
  const parent = new THREE.Group(), merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground.reads'), scope = new Scope('reads');
  const mesh = tile(-250, -250), g = mesh.geometry, position = g.getAttribute('position');
  const interleaved = new THREE.InterleavedBuffer(new Float32Array(Array.from({ length: 6 * 5 }, (_, i) => i * 0.37 - 3)), 5);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 1));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 2, 0));
  g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(Array.from({ length: 18 }, (_, i) => i * 13)), 3, true));
  g.setAttribute('uv', new THREE.Float16BufferAttribute(new Uint16Array(Array.from({ length: 12 }, (_, i) => THREE.DataUtils.toHalfFloat(i * 0.1 + 0.03))), 2));
  mesh.position.set(3, 4, 5); mesh.rotation.y = 0.3; mesh.updateMatrix();
  merge.add(mesh, scope); await settle();
  const merged = merge.mesh?.geometry; if (merged === undefined) throw new Error('no merged mesh');
  for (const name of ['splat', 'normal', 'color', 'uv']) {
    const source = g.getAttribute(name), out = merged.getAttribute(name);
    for (let i = 0; i < source.count; i++) for (let c = 0; c < source.itemSize; c++) expect(out.getComponent(i, c)).toBe(Math.fround(source.getComponent(i, c)));
  }
  const moved = merged.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const want = new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), i).applyMatrix4(mesh.matrix);
    expect([moved.getX(i), moved.getY(i), moved.getZ(i)]).toEqual([Math.fround(want.x), Math.fround(want.y), Math.fround(want.z)]);
  }
  scope.dispose();
});

// PF19: grouping changes submissions, never the carried triangle/channel words.
test('opted-in cell ground merges four quadrants with exact channels and scoped retirement', async () => {
  const parent = new THREE.Group(), oldParent = new THREE.Group(), material = new THREE.MeshBasicMaterial();
  const cell = new GroundMerge(parent, material, 'ground.fine', undefined, 'cell');
  const quarters = new GroundMerge(oldParent, material, 'ground.fine');
  const scopes = Array.from({length:4}, (_, i) => new Scope(`cell-ground-${String(i)}`));
  const points = [[-250,-250],[0,-250],[-250,0],[0,0]] as const;
  for (const [i, [x,z]] of points.entries()) {
    const scope = scopes[i]; if (scope === undefined) throw new Error('Missing tile scope');
    cell.add(tile(x,z), scope); quarters.add(tile(x,z), scope);
  }
  await settle();
  const words = (meshes: readonly THREE.Mesh[]): string[] => {
    const rows: string[] = [];
    for (const mesh of meshes) {
      const geometry = mesh.geometry, index = geometry.getIndex(); if (index === null) throw new Error('Ground needs indexed triangles');
      const attributes = Object.entries(geometry.attributes).sort(([a],[b]) => a.localeCompare(b));
      for (let at = 0; at < index.count; at += 3) {
        const values: number[] = [];
        for (let corner = 0; corner < 3; corner++) for (const [, attribute] of attributes) for (let component = 0; component < attribute.itemSize; component++)
          values.push(attribute.getComponent(index.getX(at+corner), component));
        const floats = Float32Array.from(values); rows.push([...new Uint32Array(floats.buffer)].join(','));
      }
    }
    return rows.sort();
  };
  expect(quarters.meshes).toHaveLength(4); expect(cell.meshes).toHaveLength(1);
  expect(words(cell.meshes)).toEqual(words(quarters.meshes));
  const bounds = new THREE.Box3();
  for (const mesh of quarters.meshes) { if (mesh.geometry.boundingBox === null) throw new Error('Missing kept bounds'); bounds.union(mesh.geometry.boundingBox); }
  expect(cell.mesh?.geometry.boundingBox).toEqual(bounds);
  scopes[1]?.dispose(); await settle(); expect(words(cell.meshes)).toEqual(words(quarters.meshes));
  for (const scope of scopes) scope.dispose(); await settle();
  expect(cell.meshes).toHaveLength(0); expect(parent.children).toHaveLength(0);
});

test('cell ground keeps differing vertex channel layouts in separate submissions', async () => {
  const parent = new THREE.Group(), merge = new GroundMerge(parent, new THREE.MeshBasicMaterial(), 'ground.fine', undefined, 'cell');
  const a = new Scope('splat'), b = new Scope('splat-colour'), first = tile(-250,-250), second = tile(0,-250);
  second.geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({length:18}, () => .5),3));
  merge.add(first,a); merge.add(second,b); await settle();
  expect(merge.meshes).toHaveLength(2); expect(merge.meshes.filter(mesh => mesh.geometry.hasAttribute('color'))).toHaveLength(1);
  a.dispose(); b.dispose(); await settle(); expect(parent.children).toHaveLength(0);
});
