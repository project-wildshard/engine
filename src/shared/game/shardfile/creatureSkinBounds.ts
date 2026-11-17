import * as v from 'valibot';
import { glbBuffers } from '@wildshard/format/glbBuffers';
import { parseGlbData } from '@wildshard/format/glbCost';

const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(4_000_000));
const Doc = v.looseObject({ nodes: v.array(v.object({ mesh: v.optional(count), skin: v.optional(count) })),
  meshes: v.array(v.object({ primitives: v.array(v.object({ attributes: v.object({ POSITION: count }) })) })), accessors: v.array(v.unknown()) });
const Accessor = v.object({ bufferView: count, byteOffset: v.optional(count, 0), componentType: v.picklist([5126, 5122]),
  type: v.literal('VEC3'), count, normalized: v.optional(v.boolean(), false) });
const View = v.object({ byteOffset: v.optional(count, 0), byteStride: v.optional(count), byteLength: count });

/** Rest geometry as the skin instance draws it. Static-prop triangle visitors
 * deliberately refuse deforming skins; read admitted position streams directly. */
export function creatureSkinBounds(bytes: Uint8Array): { lower: number; upper: number } {
  parseGlbData(bytes);
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true);
  const doc = v.parse(Doc, JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))));
  const nodes = doc.nodes.filter(node => node.skin !== undefined && node.mesh !== undefined), node = nodes[0];
  const mesh = node?.mesh === undefined ? undefined : doc.meshes[node.mesh];
  if (nodes.length !== 1 || mesh === undefined) throw new Error('Creature bounds need one admitted skin');
  const data = glbBuffers(doc, bytes.subarray(28 + length)), binary = new DataView(data.bytes.buffer, data.bytes.byteOffset, data.bytes.byteLength);
  let lower = 0, upper = 0;
  for (const primitive of mesh.primitives) {
    const accessor = v.parse(Accessor, doc.accessors[primitive.attributes.POSITION]), view = v.parse(View, data.views[accessor.bufferView]);
    const width = accessor.componentType === 5126 ? 4 : 2, stride = view.byteStride ?? width * 3;
    if (stride < width * 3 || accessor.byteOffset + (accessor.count - 1) * stride + width * 3 > view.byteLength) throw new Error('Invalid creature position bounds');
    for (let index = 0; index < accessor.count; index++) {
      const at = view.byteOffset + accessor.byteOffset + index * stride + width;
      const raw = width === 4 ? binary.getFloat32(at, true) : binary.getInt16(at, true);
      const y = width === 2 && accessor.normalized ? Math.max(raw / 32767, -1) : raw;
      lower = Math.min(lower, y); upper = Math.max(upper, y);
    }
  }
  return { lower, upper };
}
