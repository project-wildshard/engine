import * as THREE from 'three';
import { expect, test } from 'vitest';
import { patchShader } from '@wildshard/engine/render/shaderPatches';
import { prepareFarCopyIndices, resetFarLod, settleFarCopies } from '@wildshard/engine/render/farLod';
import { batchableMesh, buildKitBatches, KitBatch, kitBatch, prepareBakedTileBatch } from './kitBatch';

// DF10 (mini-df10e): the level's plain meshes of one material draw as one batch; each member stays the source of its pose,
// visibility and draw range, and a member that changes leaves for good and draws itself again.
function box(sway: boolean, indexed = true): THREE.BufferGeometry {
  const made = new THREE.BoxGeometry(1, 1, 1);
  const geometry = indexed ? made : made.toNonIndexed();
  geometry.deleteAttribute('uv'); geometry.clearGroups();
  if (sway) geometry.setAttribute('aSway', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(1), 1));
  return geometry;
}

test('the phone Low default is on and an explicit boolean wins', () => {
  expect(kitBatch(null)).toBe(true);
  expect(kitBatch(true)).toBe(true);
  expect(kitBatch(false)).toBe(false);
});

test('a flat material batches members with and without normals together', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial({ flatShading: true });
  const withNormals = box(false), withoutNormals = box(false);
  withoutNormals.deleteAttribute('normal');
  scene.add(new THREE.Mesh(withNormals, material), new THREE.Mesh(withoutNormals, material));
  const [batch] = buildKitBatches(scene);
  expect(batch?.members).toHaveLength(2);
  const normals = batch?.geometry.getAttribute('normal');
  expect(normals?.getX(0)).toBe(withNormals.getAttribute('normal').getX(0));
  expect(normals?.getX(withNormals.getAttribute('position').count)).toBe(0);
});

test('road kit supplies the combined buffer bounds and retains the exact member bounds', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  const a = new THREE.Mesh(box(false), material);
  const b = new THREE.Mesh(box(false).translate(5, 2, -4), material);
  a.position.set(11, 0, 8);
  scene.add(a, b);
  scene.updateWorldMatrix(true, true);
  const format = { itemSize: 3, normalized: false, Typed: Float32Array };
  const batch = KitBatch.of([a, b], material, new Map([['position', format], ['normal', format]]), false, scene, true);
  const fromBuffer = new THREE.Box3().setFromBufferAttribute(batch.geometry.getAttribute('position') as THREE.BufferAttribute);
  expect(batch.geometry.boundingBox).toEqual(fromBuffer);
  expect(batch.geometry.boundingSphere).toEqual(fromBuffer.getBoundingSphere(new THREE.Sphere()));
  expect(batch.getBoundingBoxAt(0, new THREE.Box3())).toEqual(a.geometry.boundingBox);
  expect(batch.getBoundingSphereAt(1, new THREE.Sphere())).toEqual(b.geometry.boundingSphere);
  batch.retire();
});

test('opaque baked tiles keep their lightmap UVs and changing draw ranges in a batch', () => {
  const root = new THREE.Scene(), material = new THREE.ShaderMaterial();
  const mesh = (): THREE.Mesh => {
    const geometry = box(false);
    const uv = new Uint16Array(geometry.getAttribute('position').count * 4).fill(16384);
    const channel = new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(uv, 4), 2, 1, true);
    geometry.setAttribute('uv', channel);
    const tile = new THREE.Mesh(geometry, material);
    prepareBakedTileBatch(tile);
    root.add(tile);
    return tile;
  };
  const a = mesh();
  mesh();
  expect(buildKitBatches(root)).toHaveLength(0);
  const [batch] = buildKitBatches(root, false, true);
  if (batch === undefined) throw new Error('one baked tile batch');
  expect(batch.material).toBe(material);
  const uv = batch.geometry.getAttribute('uv');
  expect(uv.array[0]).toBe(16384);
  expect(uv.getX(0)).toBeCloseTo(0.25);
  const member = batch.members.find(row => row.mesh === a);
  if (member === undefined) throw new Error('baked tile member missing');
  a.geometry.setDrawRange(0, 3);
  batch.sync();
  const ranges = Reflect.get(batch, '_geometryInfo') as { count: number }[];
  expect(ranges[member.geometryId]?.count).toBe(3);
});

test('a kit batch keeps each wide member’s far indices and is warmed as one draw', async () => {
  resetFarLod(true);
  try {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), material = new THREE.MeshBasicMaterial();
    const first = new THREE.Mesh(new THREE.PlaneGeometry(140, 140, 64, 64), material);
    const next = new THREE.Mesh(first.geometry.toNonIndexed(), material);
    scene.add(first, next);
    const [batch] = buildKitBatches(scene);
    if (batch === undefined) throw new Error('one kit batch');
    expect(first.layers.mask).toBe(0);
    expect(next.geometry.index).not.toBeNull();
    await settleFarCopies({ scene });
    camera.position.set(-220, 10, -220);
    const refresh = await prepareFarCopyIndices(scene, camera, () => true, () => Promise.resolve());
    expect(refresh).toEqual(new Set([batch]));
    batch.sync();
    const ranges = Reflect.get(batch, '_geometryInfo') as { count: number }[];
    for (const member of batch.members) {
      expect(member.geometry.drawRange.count).toBeLessThan(member.drawn);
      expect(ranges[member.geometryId]?.count).toBe(member.geometry.drawRange.count);
    }
    batch.retire();
    expect(first.layers.mask).toBe(1);
  } finally { resetFarLod(); }
});

test('a returning region owns its kit in cell coordinates', () => {
  const scene = new THREE.Scene(), root = new THREE.Group();
  root.position.set(420, 0, -220);
  root.rotation.y = Math.PI / 2;
  scene.add(root);
  const material = new THREE.MeshLambertMaterial();
  const a = new THREE.Mesh(box(false), material), b = new THREE.Mesh(box(false), material);
  a.position.set(3, 1, 2);
  root.add(a, b);
  const [batch] = buildKitBatches(root);
  if (batch === undefined) throw new Error('one batch');
  expect(batch.parent).toBe(root);
  const [member] = batch.members;
  if (member === undefined) throw new Error('kit member');
  const matrix = new THREE.Matrix4();
  const rendered = (): number[] => {
    batch.getMatrixAt(member.instance, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix.premultiply(batch.matrixWorld)).toArray();
  };
  const expected = (): number[] => a.getWorldPosition(new THREE.Vector3()).toArray();
  expect(rendered()).toEqual(expected());
  root.position.x += 10;
  a.position.z = 7;
  scene.updateMatrixWorld(true);
  batch.sync();
  expect(rendered()).toEqual(expected());
  batch.retire();
  expect(batch.parent).toBeNull();
  expect([a.layers.mask, b.layers.mask]).toEqual([1, 1]);
});

test('meshes of one material share a batch that follows each member', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshLambertMaterial(), other = new THREE.MeshLambertMaterial();
  const group = new THREE.Group(); scene.add(group);
  const a = new THREE.Mesh(box(true), material), b = new THREE.Mesh(box(false, false), material), c = new THREE.Mesh(box(false), material);
  const alone = new THREE.Mesh(box(false), other);
  a.position.set(5, 0, 0); group.add(a, b, alone); scene.add(c);
  const ranged = c.geometry.index?.count ?? 0;
  c.geometry.setDrawRange(0, 12);
  const batches = buildKitBatches(scene);
  expect(batches.length).toBe(1); // the lone material keeps its own draw
  const [batch] = batches;
  if (batch === undefined) throw new Error('one batch');
  expect(batch.members.length).toBe(3);
  expect([a.layers.mask, b.layers.mask, c.layers.mask, alone.layers.mask]).toEqual([0, 0, 0, 1]);
  expect(batch.geometry.getAttribute('aSway').count).toBe(batch.geometry.getAttribute('position').count);
  // the member's range is the copy's span of its own indices
  const at = (mesh: THREE.Mesh): number => batch.members.findIndex(member => member.mesh === mesh);
  const rows = Reflect.get(batch, '_geometryInfo') as { start: number; count: number; indexStart: number }[];
  const rowC = rows[batch.members[at(c)]?.geometryId ?? -1];
  expect(rowC?.count).toBe(12);
  c.geometry.setDrawRange(6, Infinity); batch.sync();
  expect([rowC?.start, rowC?.count]).toEqual([(rowC?.indexStart ?? 0) + 6, ranged - 6]);
  // hidden with its group; moved with its member
  group.visible = false; batch.sync();
  expect([batch.getVisibleAt(at(a)), batch.getVisibleAt(at(c))]).toEqual([false, true]);
  group.visible = true; a.position.x = 9; a.updateMatrixWorld(true); batch.sync();
  const m = new THREE.Matrix4(); batch.getMatrixAt(batch.members[at(a)]?.instance ?? -1, m);
  expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(9);
  // a new material: it leaves and draws itself
  a.material = other; batch.sync();
  expect(batch.getVisibleAt(at(a))).toBe(false);
  expect(a.layers.mask).toBe(1);
  batch.retire();
  expect([b.layers.mask, c.layers.mask]).toEqual([1, 1]);
  expect(scene.children.includes(batch)).toBe(false);
});

test('a mesh the batch cannot copy or draw keeps its own draw', () => {
  const material = new THREE.MeshLambertMaterial();
  const transparent = new THREE.Mesh(box(false), new THREE.MeshLambertMaterial({ transparent: true }));
  const gone = new THREE.Mesh(box(false), material);
  const normal = gone.geometry.getAttribute('normal') as THREE.BufferAttribute;
  normal.array = normal.array.slice(0, 0); // its CPU copy already went at upload
  const skinned = new THREE.SkinnedMesh(box(false), material);
  expect([batchableMesh(transparent), batchableMesh(gone), batchableMesh(skinned), batchableMesh(new THREE.Mesh(box(false), material))]).toEqual([false, false, false, true]);
});

test('members whose channels are stored differently share a batch in floats', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const bytes = box(false), floats = box(false);
  bytes.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(bytes.getAttribute('position').count * 3).fill(255), 3, true));
  floats.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(floats.getAttribute('position').count * 3).fill(0.5), 3));
  scene.add(new THREE.Mesh(bytes, material), new THREE.Mesh(floats, material));
  const [batch] = buildKitBatches(scene);
  const color = batch?.geometry.getAttribute('color');
  expect(color?.array).toBeInstanceOf(Float32Array);
  expect([color?.getX(0), color?.getX(color.count - 1)]).toEqual([1, 0.5]);
});

// DF8 (mini-df8c): a cell's look patch leaves with its cell; the level's batch then draws its members no more (it drew
// them for a frame mid-teardown with the patch gone, a program linked at draw)
test('a batch whose cell look patch left draws nothing again', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshLambertMaterial();
  const undo = patchShader(material, 'region.look', 990, () => undefined, { key: (before) => `${before}|look:test`, pureKey: true });
  const a = new THREE.Mesh(box(false), material), b = new THREE.Mesh(box(false), material);
  b.position.set(3, 0, 0); scene.add(a, b);
  const [batch] = buildKitBatches(scene, true);
  if (batch === undefined) throw new Error('one batch');
  batch.sync();
  expect(batch.members.map(member => batch.getVisibleAt(member.instance))).toEqual([true, true]);
  undo(); batch.sync();
  expect(batch.members.map(member => batch.getVisibleAt(member.instance))).toEqual([false, false]);
  // it stays dark: its members go with their cell
  a.visible = true; batch.sync();
  expect(batch.getVisibleAt(batch.members[0]?.instance ?? -1)).toBe(false);
  batch.retire();
});
