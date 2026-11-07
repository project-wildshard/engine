import { expect, test } from 'vitest';
import { BoxGeometry, BufferAttribute, type BufferGeometry, CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Object3D, SkinnedMesh, Vector3, Vector4 } from 'three';
import { mergeHeldParts } from './ranged';

function attribute(geometry: BufferGeometry, name: string): BufferAttribute {
  const value = geometry.getAttribute(name);
  if (!(value instanceof BufferAttribute)) throw new Error(`Missing ${name}`);
  return value;
}
/** where three's attached rigid skinning puts merged vertex `v`: bindMatrixInverse · bone · bindMatrix · v, then the mesh's world */
function skinned(mesh: SkinnedMesh, v: number): Vector3 {
  const index = new Vector4().fromBufferAttribute(attribute(mesh.geometry, 'skinIndex'), v);
  mesh.skeleton.update();
  const palette = mesh.skeleton.boneMatrices;
  if (palette === null || mesh.skeleton.bones[index.x] === undefined) throw new Error('Missing bone');
  const boneMatrix = new Matrix4().fromArray(palette, index.x * 16);
  return new Vector3().fromBufferAttribute(attribute(mesh.geometry, 'position'), v)
    .applyMatrix4(mesh.bindMatrix).applyMatrix4(boneMatrix).applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
}

test('PF13: same-material held parts draw as one rigid-skinned draw, each vertex where its part drew it', () => {
  const cord = new MeshStandardMaterial(), wood = new MeshStandardMaterial();
  const root = new Group(), holder = new Object3D();
  holder.position.set(3, -2, 7); holder.rotation.set(0.3, 1.1, -0.2); holder.add(root); root.scale.setScalar(0.6);
  const leg = new CylinderGeometry(0.01, 0.01, 1, 7), left = new Mesh(leg, cord), right = new Mesh(leg, cord), serving = new Mesh(new CylinderGeometry(0.02, 0.02, 0.05, 8), cord);
  const stock = new Mesh(new BoxGeometry(), wood), bolt = new Mesh(new BoxGeometry(), cord);
  root.add(left, right, serving, stock, bolt);
  expect(mergeHeldParts(root, [bolt])).toBe(2);
  const merged = root.children.find((child): child is SkinnedMesh => child instanceof SkinnedMesh);
  if (merged === undefined || root.children.at(-1) !== merged) throw new Error('Missing merged draw');
  expect(merged.material).toBe(cord); expect(merged.userData['viewmodelOnly']).toBe(true);
  // the merged parts stop drawing; the rest (another material, a kept part) draw as before
  expect([left, right, serving].map(m => m.layers.mask)).toEqual([0, 0, 0]); expect([stock, bolt].map(m => m.layers.mask)).toEqual([1, 1]);
  // pose the legs as the string's playback does (a stretched, turned leg), then compare every vertex with its part's own draw
  left.position.set(-0.2, 0.01, -0.2); left.rotation.set(0, 0, 1.2); left.scale.set(1, 0.31, 1);
  right.position.set(0.2, 0.01, -0.2); right.rotation.set(0, 0, -1.2); right.scale.set(1, 0.29, 1);
  serving.position.set(0, 0.009, 0.1);
  holder.updateMatrixWorld(true);
  const parts = [left, right, serving];
  let v = 0;
  for (const part of parts) {
    const n = attribute(part.geometry, 'position').count;
    for (let k = 0; k < n; k++, v++) {
      const own = new Vector3().fromBufferAttribute(attribute(part.geometry, 'position'), k).applyMatrix4(part.matrixWorld);
      const at = skinned(merged, v);
      expect(at.distanceTo(own)).toBeLessThan(1e-6);
    }
  }
  // a hidden part (or a hidden node above it) collapses to a point: nothing of it draws
  right.visible = false; holder.updateMatrixWorld(true);
  const rightStart = attribute(left.geometry, 'position').count;
  expect(skinned(merged, rightStart).length()).toBeLessThan(1e-6); expect(skinned(merged, rightStart + 5).length()).toBeLessThan(1e-6);
  right.visible = true; holder.updateMatrixWorld(true);
  expect(skinned(merged, rightStart).distanceTo(new Vector3().fromBufferAttribute(attribute(leg, 'position'), 0).applyMatrix4(right.matrixWorld))).toBeLessThan(1e-6);
  // a single part of a material is left alone
  const lone = new Group(); lone.add(new Mesh(new BoxGeometry(), wood));
  expect(mergeHeldParts(lone)).toBe(0); expect(lone.children.length).toBe(1);
});
