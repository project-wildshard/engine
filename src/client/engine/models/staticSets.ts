import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix3, Mesh, Object3D, SkinnedMesh, type InterleavedBufferAttribute, type Material, type Matrix4 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WorkSlice } from '../../../shared/engine/core/workSlice';
import { geometryBoundsSteps } from '../world/geometryBounds';

/**
 * Static sibling meshes as one draw (G639 frame floor; scene dressing always merges, DR7 / G669).
 *
 * A placed static piece (a camp, a run of fences, a set of crags) is often built as several sibling meshes that share one
 * material: each costs a draw (~100 µs of script a draw at phone 4x) for no difference on screen. `mergeStaticSiblingsSliced`
 * merges a root's direct children that are plain meshes with the same material instance and the same draw state into one
 * mesh per group, their geometry baked in the root's frame. Instanced, skinned, morphing, grouped, hidden or hooked meshes,
 * and meshes with children, are left as they are. The source geometries are not disposed (a catalogue may share them);
 * the caller owns the merged ones it gets back.
 */
const defaultBeforeRender: unknown = Reflect.get(Object3D.prototype, 'onBeforeRender');
const isGeometry = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;
function mergeable(node: Object3D): node is Mesh<BufferGeometry, Material> {
  if (!(node instanceof Mesh) || node instanceof InstancedMesh || node instanceof SkinnedMesh) return false;
  const geometry: unknown = node.geometry, material: unknown = node.material, hook: unknown = Reflect.get(node, 'onBeforeRender');
  return node.visible && node.children.length === 0 && hook === defaultBeforeRender && !Array.isArray(material)
    && isGeometry(geometry) && geometry.groups.length === 0 && Object.keys(geometry.morphAttributes).length === 0;
}
const normalMatrix = new Matrix3();
const plainVectors = (attribute: BufferAttribute | InterleavedBufferAttribute | undefined): attribute is BufferAttribute & { array: Float32Array } =>
  attribute instanceof BufferAttribute && !attribute.normalized && attribute.itemSize === 3 && attribute.array instanceof Float32Array;
/** `geometry.applyMatrix4(matrix)` on a private merge copy with no bounds: the same float math, read and written straight on
 *  Float32 positions and normals (T10: three's per-vertex reads and writes were 24 ms of a Nalati entry's dressing at phone
 *  4x). A tangent, or any other storage, takes three's own path. */
function transformCopy(geometry: BufferGeometry, matrix: Matrix4): void {
  const position = geometry.attributes['position'], normal = geometry.attributes['normal'];
  if (geometry.attributes['tangent'] !== undefined || (position !== undefined && !plainVectors(position)) || (normal !== undefined && !plainVectors(normal))) {
    geometry.applyMatrix4(matrix); return;
  }
  if (position !== undefined) {
    const e = matrix.elements, out = position.array;
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i] ?? 0, y = out[i + 1] ?? 0, z = out[i + 2] ?? 0, w = 1 / ((e[3] ?? 0) * x + (e[7] ?? 0) * y + (e[11] ?? 0) * z + (e[15] ?? 1));
      out[i] = ((e[0] ?? 1) * x + (e[4] ?? 0) * y + (e[8] ?? 0) * z + (e[12] ?? 0)) * w;
      out[i + 1] = ((e[1] ?? 0) * x + (e[5] ?? 1) * y + (e[9] ?? 0) * z + (e[13] ?? 0)) * w;
      out[i + 2] = ((e[2] ?? 0) * x + (e[6] ?? 0) * y + (e[10] ?? 1) * z + (e[14] ?? 0)) * w;
    }
    position.needsUpdate = true;
  }
  if (normal !== undefined) {
    const e = normalMatrix.getNormalMatrix(matrix).elements, out = normal.array;
    for (let i = 0; i < out.length; i += 3) {
      const x = out[i] ?? 0, y = out[i + 1] ?? 0, z = out[i + 2] ?? 0;
      const nx = (e[0] ?? 1) * x + (e[3] ?? 0) * y + (e[6] ?? 0) * z, ny = (e[1] ?? 0) * x + (e[4] ?? 1) * y + (e[7] ?? 0) * z, nz = (e[2] ?? 0) * x + (e[5] ?? 0) * y + (e[8] ?? 1) * z;
      const scale = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1); // Vector3.normalize
      out[i] = nx * scale; out[i + 1] = ny * scale; out[i + 2] = nz * scale;
    }
    normal.needsUpdate = true;
  }
}
function signature(node: Mesh<BufferGeometry, Material>): string {
  const geometry = node.geometry, attributes = Object.keys(geometry.attributes).sort().map((name) => {
    const a = geometry.getAttribute(name);
    return `${name}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array.constructor.name}`;
  });
  return [node.material.uuid, node.castShadow, node.receiveShadow, node.renderOrder, node.frustumCulled, node.layers.mask, geometry.index === null ? 'flat' : 'indexed', ...attributes].join('|');
}

/** Merge `root`'s mergeable sibling meshes, per material and draw state, into one mesh each, under `slice`: it yields after
 *  each member's transformed copy, each bounds chunk and each merged group (one task was ~84 ms of Nalati's dressing in a cold crossing's
 *  world step at phone 4× CPU). Returns the merged geometries (for the caller to own) and how many draws that removed. */
export async function mergeStaticSiblingsSliced(root: Object3D, slice: WorkSlice): Promise<{ readonly geometries: readonly BufferGeometry[]; readonly saved: number }> {
  const steps = mergeSteps(root);
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) { if (step.value === undefined) throw new Error('Static sibling merge did not finish'); return step.value; }
      const pause = slice.check(); if (pause !== undefined) await pause;
    }
  } finally { steps.return(undefined); }
}

function* mergeSteps(root: Object3D): Generator<void, { readonly geometries: readonly BufferGeometry[]; readonly saved: number } | undefined> {
  const groups = new Map<string, Mesh<BufferGeometry, Material>[]>();
  for (const child of root.children) if (mergeable(child)) {
    const key = signature(child), list = groups.get(key);
    if (list === undefined) groups.set(key, [child]); else list.push(child);
  }
  const geometries: BufferGeometry[] = [], made: Mesh[] = [], temporary = new Set<BufferGeometry>();
  let saved = 0, completed = false;
  try {
    for (const members of groups.values()) {
      const first = members[0];
      if (members.length < 2 || first === undefined) continue;
      const parts: BufferGeometry[] = [];
      for (const member of members) {
        member.updateMatrix(); const copy = member.geometry.clone(); temporary.add(copy);
        // These copies are private merge inputs, never drawn. Transform only
        // their attributes; the merged result gets exact bounds below. Keeping
        // cloned bounds here rescans every member before scanning the union.
        copy.boundingBox = null; copy.boundingSphere = null;
        transformCopy(copy, member.matrix); parts.push(copy); yield;
      }
      // typed non-null, but null on a layout mismatch
      const merged: unknown = mergeGeometries(parts, false);
      for (const part of parts) { part.dispose(); temporary.delete(part); }
      if (!isGeometry(merged)) continue;
      temporary.add(merged);
      yield* geometryBoundsSteps(merged); // one exact box scan plus the radius, in bounded CPU chunks
      const mesh = new Mesh(merged, first.material);
      mesh.name = `${first.name || 'mesh'}+${String(members.length - 1)}`;
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow; mesh.renderOrder = first.renderOrder;
      mesh.frustumCulled = first.frustumCulled; mesh.layers.mask = first.layers.mask;
      for (const member of members) root.remove(member);
      root.add(mesh); made.push(mesh);
      geometries.push(merged); temporary.delete(merged); saved += members.length - 1;
      yield;
    }
    completed = true; return { geometries, saved };
  } finally {
    for (const geometry of temporary) geometry.dispose();
    if (!completed) { for (const mesh of made) mesh.removeFromParent(); for (const geometry of geometries) geometry.dispose(); }
  }
}
