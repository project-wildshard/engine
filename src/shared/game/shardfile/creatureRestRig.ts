import { Matrix4, Quaternion, Vector3 } from 'three';
import * as v from 'valibot';
import { parseGlbData } from '@wildshard/format/glbCost';
import { glbBuffers } from '@wildshard/format/glbBuffers';
import type { CreatureRestJoint } from './creatureVolumes';

const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4_000_000));
const Doc = v.looseObject({
  nodes: v.array(v.object({ name: v.optional(v.string()), children: v.optional(v.array(count), []), skin: v.optional(count), mesh: v.optional(count) })),
  skins: v.array(v.object({ joints: v.array(count), inverseBindMatrices: count })),
  accessors: v.array(v.unknown()),
});
const Accessor = v.object({ bufferView: count, byteOffset: v.optional(count, 0),
  componentType: v.literal(5126), type: v.literal('MAT4'), count });
const View = v.object({ byteOffset: v.optional(count, 0), byteStride: v.optional(count, 64), byteLength: count });

/** Same position-only inverse-bind rest contract as clientSkins, without a renderer.
 * Reads admitted GLB bytes, including meshopt-normalized buffer views. */
export function creatureRestRig(bytes: Uint8Array, expected: readonly string[]): readonly CreatureRestJoint[] {
  parseGlbData(bytes);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), length = header.getUint32(12, true);
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))), doc = v.parse(Doc, raw);
  const meshes = doc.nodes.filter(node => node.skin !== undefined && node.mesh !== undefined), mesh = meshes[0];
  const skin = mesh?.skin === undefined ? undefined : doc.skins[mesh.skin];
  if (meshes.length !== 1 || skin === undefined || skin.joints.length !== expected.length || skin.joints.length > 32) throw new Error('Creature rest rig needs one bounded skin');
  const parents = new Map<number, number>();
  for (const [parent, node] of doc.nodes.entries()) for (const child of node.children) {
    if (parents.has(child)) throw new Error('Ambiguous creature rest parent');
    parents.set(child, parent);
  }
  const data = glbBuffers(doc, bytes.subarray(28 + length)), accessor = v.parse(Accessor, doc.accessors[skin.inverseBindMatrices]);
  const view = v.parse(View, data.views[accessor.bufferView]);
  if (accessor.count !== skin.joints.length || view.byteStride < 64
    || accessor.byteOffset + (accessor.count - 1) * view.byteStride + 64 > view.byteLength) throw new Error('Invalid creature inverse binds');
  const binary = new DataView(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength);
  const positions = new Map<number, Vector3>(), names = new Map<number, string>();
  const matrix = new Matrix4(), rotation = new Quaternion(), scale = new Vector3();
  for (const [index, node] of skin.joints.entries()) {
    const name = doc.nodes[node]?.name;
    if (name === undefined || name !== expected[index] || names.has(node) || [...names.values()].includes(name)) throw new Error('Creature rest joint order differs from skin');
    const at = view.byteOffset + accessor.byteOffset + index * view.byteStride;
    for (let field = 0; field < 16; field++) matrix.elements[field] = binary.getFloat32(at + field * 4, true);
    if (Math.abs(matrix.determinant()) < 1e-12) throw new Error('Singular creature inverse bind');
    const position = new Vector3(); matrix.invert().decompose(position, rotation, scale);
    if (Math.abs(Math.abs(rotation.w) - 1) > 1e-5 || Math.abs(scale.x - 1) + Math.abs(scale.y - 1) + Math.abs(scale.z - 1) > 1e-5) throw new Error('Creature bind pose must be unrotated and unscaled');
    names.set(node, name); positions.set(node, position);
  }
  const result: CreatureRestJoint[] = [], indices = new Map<number, number>(), visiting = new Set<number>();
  const append = (node: number): number => {
    const previous = indices.get(node); if (previous !== undefined) return previous;
    if (visiting.has(node)) throw new Error('Cyclic creature rest rig');
    visiting.add(node);
    const parentNode = parents.get(node), parent = parentNode !== undefined && names.has(parentNode) ? append(parentNode) : -1;
    const position = positions.get(node), name = names.get(node);
    if (position === undefined || name === undefined) throw new Error('Missing creature rest joint');
    const local = position.clone(); if (parentNode !== undefined && parent !== -1) local.sub(positions.get(parentNode) ?? new Vector3());
    const index = result.length; result.push({ name, parent, position: [local.x, local.y, local.z] });
    indices.set(node, index); visiting.delete(node); return index;
  };
  for (const node of skin.joints) append(node);
  return result;
}
