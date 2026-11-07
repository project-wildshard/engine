import { expect, test } from 'vitest';
import { BoxGeometry, DetachedBindMode, Group, Matrix4, Mesh, MeshBasicMaterial, Object3D, SkinnedMesh, Vector3 } from 'three';
import { skinRigid } from '../src/client/game/systems/viewmodel/rigArms';

// NF15: a rigid held hull draws as a skinned mesh on one identity bone, so it shares the skinned hulls' program; the
// skinning must leave every vertex exactly where it was
test('a rigid part becomes a skinned mesh on an identity bone in its place, every vertex unmoved', () => {
  const geometry = new BoxGeometry(1, 2, 3), material = new MeshBasicMaterial(), socket = new Group(), child = new Object3D();
  const rigid = new Mesh(geometry, material);
  rigid.name = 'sword_jian_hull'; rigid.position.set(0.1, 0.2, 0.3); rigid.rotation.set(0.4, 0.5, 0.6); rigid.renderOrder = -1; rigid.add(child);
  socket.add(rigid);
  try {
    const skinned = skinRigid(rigid);
    expect(skinned).toBeInstanceOf(SkinnedMesh); expect(socket.children).toEqual([skinned]); expect(rigid.parent).toBeNull();
    expect(skinned.name).toBe('sword_jian_hull'); expect(skinned.material).toBe(material); expect(skinned.geometry).toBe(geometry);
    expect(skinned.renderOrder).toBe(-1); expect(skinned.children).toEqual([child]);
    expect(skinned.position.toArray()).toEqual(rigid.position.toArray()); expect(skinned.quaternion.toArray()).toEqual(rigid.quaternion.toArray());
    expect(skinned.bindMode).toBe(DetachedBindMode); expect(skinned.bindMatrix.equals(new Matrix4())).toBe(true);
    skinned.updateMatrixWorld(true); skinned.skeleton.update();
    expect(skinned.bindMatrixInverse.equals(new Matrix4())).toBe(true);
    const position = geometry.getAttribute('position'), v = new Vector3();
    for (let i = 0; i < position.count; i++) {
      skinned.applyBoneTransform(i, v.fromBufferAttribute(position, i));
      expect(v.toArray()).toEqual([position.getX(i), position.getY(i), position.getZ(i)]);
    }
    // a second rig clone shares the geometry: its channels are made once
    const weights = geometry.getAttribute('skinWeight');
    skinRigid(new Mesh(geometry, material));
    expect(geometry.getAttribute('skinWeight')).toBe(weights);
  } finally { geometry.dispose(); material.dispose(); }
});

test('the cached identity palette does not freeze a moving parent or any rigid world-space vertex', () => {
  const geometry = new BoxGeometry(1,2,3), material = new MeshBasicMaterial(), socket = new Group(), stockSocket = new Group();
  const rigid = new Mesh(geometry,material), stock = new Mesh(geometry,material);
  rigid.position.set(.2,.3,.4); stock.position.copy(rigid.position); socket.add(rigid); stockSocket.add(stock);
  const skinned = skinRigid(rigid);
  try {
    const position = geometry.getAttribute('position'), actual = new Vector3(), expected = new Vector3();
    for (let frame = 0; frame < 36; frame++) {
      for (const parent of [socket,stockSocket]) {
        parent.position.set(frame*.1,Math.sin(frame*.2),-frame*.2);
        parent.rotation.set(frame*.03,frame*.05,-frame*.02); parent.scale.setScalar(1+frame*.01); parent.updateMatrixWorld(true);
      }
      skinned.skeleton.update();
      for (let vertex = 0; vertex < position.count; vertex++) {
        skinned.applyBoneTransform(vertex,actual.fromBufferAttribute(position,vertex)).applyMatrix4(skinned.matrixWorld);
        expected.fromBufferAttribute(position,vertex).applyMatrix4(stock.matrixWorld);
        expect(actual.toArray()).toEqual(expected.toArray());
      }
    }
  } finally { skinned.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});
