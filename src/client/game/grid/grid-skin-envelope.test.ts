import { expect, test, vi } from 'vitest';
import { Bone, Box3, BoxGeometry, BufferAttribute, Float32BufferAttribute, Group, InterleavedBuffer, InterleavedBufferAttribute, MeshBasicMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute } from 'three';
import { skinEnvelope, uploadedSkinBounds } from './skinEnvelope';

test('bone envelopes contain exact vertices through poses, rebasing and unequal weight sums', () => {
  const geometry = new BoxGeometry(2, 4, 3), material = new MeshBasicMaterial(), mesh = new SkinnedMesh(geometry, material);
  const count = geometry.getAttribute('position').count, weights = new Float32Array(count * 4), indices = new Uint16Array(count * 4);
  for (let i = 0; i < count; i++) { weights[i * 4] = i % 2 ? 0.2 : 0.8; weights[i * 4 + 1] = i % 3 ? 0.4 : 0.7; indices[i * 4 + 1] = 1; }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const root = new Group(), a = new Bone(), b = new Bone(); a.add(b); mesh.add(a); root.add(mesh); b.position.y = 2;
  root.position.set(555, 0, -1110); root.updateMatrixWorld(true); mesh.bind(new Skeleton([a, b]));
  try {
    const envelope = skinEnvelope(mesh); if (envelope === null) throw new Error('Expected a linear skin envelope');
    for (let pose = 0; pose < 12; pose++) {
      a.rotation.y = pose * 0.23; b.rotation.z = pose * -0.19; a.position.x = pose * 0.7;
      root.position.z += 0.3; root.updateMatrixWorld(true); mesh.skeleton.update();
      expect(envelope().clone().expandByScalar(0.000001).containsBox(uploadedSkinBounds(mesh, geometry.boundingBox ?? new Box3()))).toBe(true);
    }
    // an uploaded weight change (its version bumps, as the GPU needs) is scanned again
    const changed = geometry.getAttribute('skinWeight'); changed.setX(0, -0.1); changed.needsUpdate = true; expect(skinEnvelope(mesh)).toBeNull();
  } finally { mesh.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});

test('skinned copies on one geometry and bind pose share the vertex scan, each with its own pose', () => {
  const geometry = new BoxGeometry(2, 4, 3), material = new MeshBasicMaterial(), count = geometry.getAttribute('position').count;
  const weights = new Float32Array(count * 4), indices = new Uint16Array(count * 4);
  for (let i = 0; i < count; i++) { weights[i * 4] = 0.6; weights[i * 4 + 1] = 0.4; indices[i * 4 + 1] = 1; }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4)); geometry.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
  const copy = (): { mesh: SkinnedMesh; a: Bone; b: Bone } => {
    const mesh = new SkinnedMesh(geometry, material), a = new Bone(), b = new Bone(); a.add(b); mesh.add(a); b.position.y = 2;
    mesh.updateMatrixWorld(true); mesh.bind(new Skeleton([a, b])); return { mesh, a, b };
  };
  const first = copy(), second = copy(), reads = vi.spyOn(geometry.getAttribute('skinWeight'), 'getComponent');
  try {
    const one = skinEnvelope(first.mesh); reads.mockClear();
    const two = skinEnvelope(second.mesh);
    expect(reads).not.toHaveBeenCalled();
    if (one === null || two === null) throw new Error('Expected linear skin envelopes');
    first.a.rotation.y = 0.8; second.b.rotation.z = -0.6; second.a.position.x = 3;
    for (const { mesh } of [first, second]) { mesh.updateMatrixWorld(true); mesh.skeleton.update(); }
    expect(one().clone().expandByScalar(0.000001).containsBox(uploadedSkinBounds(first.mesh, new Box3()))).toBe(true);
    expect(two().clone().expandByScalar(0.000001).containsBox(uploadedSkinBounds(second.mesh, new Box3()))).toBe(true);
  } finally { reads.mockRestore(); first.mesh.skeleton.dispose(); second.mesh.skeleton.dispose(); geometry.dispose(); material.dispose(); }
});

// the typed-array scan (plain channels) and three's accessor walk (an interleaved copy of the same positions) build the
// same per-bone envelopes, for float and normalized 8-bit weights alike
test('the plain-array skin scan equals the accessor scan exactly', () => {
  for (const normalized of [false, true]) {
    const base = new BoxGeometry(2, 4, 3, 3, 5, 2), count = base.getAttribute('position').count, material = new MeshBasicMaterial();
    const indices = new Uint16Array(count * 4), floats = new Float32Array(count * 4), bytes = new Uint8Array(count * 4);
    for (let i = 0; i < count; i++) {
      bytes[i * 4] = 40 + (i * 37) % 160; bytes[i * 4 + 1] = 255 - (bytes[i * 4] ?? 0); bytes[i * 4 + 2] = i % 5 === 0 ? 7 : 0;
      for (let j = 0; j < 4; j++) floats[i * 4 + j] = (bytes[i * 4 + j] ?? 0) / 255;
      indices[i * 4] = i % 3; indices[i * 4 + 1] = (i + 1) % 3; indices[i * 4 + 2] = 2;
    }
    const build = (interleaved: boolean): { mesh: SkinnedMesh; geometry: BoxGeometry; bones: Bone[] } => {
      const geometry = base.clone();
      if (interleaved) geometry.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(Float32Array.from(base.getAttribute('position').array), 3), 3, 0));
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
      geometry.setAttribute('skinWeight', normalized ? new BufferAttribute(bytes, 4, true) : new Float32BufferAttribute(floats, 4));
      const mesh = new SkinnedMesh(geometry, material), bones = [new Bone(), new Bone(), new Bone()];
      bones[0]?.add(bones[1] ?? new Bone()); bones[1]?.add(bones[2] ?? new Bone()); mesh.add(bones[0] ?? new Bone());
      (bones[1] ?? new Bone()).position.y = 1.5; (bones[2] ?? new Bone()).position.y = 1;
      mesh.position.set(3, 1, -2); mesh.updateMatrixWorld(true); mesh.bind(new Skeleton(bones));
      return { mesh, geometry, bones };
    };
    const fast = build(false), slow = build(true);
    try {
      const a = skinEnvelope(fast.mesh), b = skinEnvelope(slow.mesh);
      if (a === null || b === null) throw new Error('Expected linear skin envelopes');
      for (let pose = 0; pose < 5; pose++) {
        for (const { mesh, bones } of [fast, slow]) { (bones[0] ?? new Bone()).rotation.y = pose * 0.31; (bones[1] ?? new Bone()).rotation.z = -pose * 0.17; mesh.updateMatrixWorld(true); mesh.skeleton.update(); }
        const one = a(), two = b();
        expect(one.min.toArray()).toEqual(two.min.toArray()); expect(one.max.toArray()).toEqual(two.max.toArray());
      }
    } finally { for (const { mesh, geometry } of [fast, slow]) { mesh.skeleton.dispose(); geometry.dispose(); } material.dispose(); base.dispose(); }
  }
});
