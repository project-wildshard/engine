import { InstancedBufferGeometry, type Box3, type BufferGeometry, type InstancedBufferAttribute, type InstancedMesh } from 'three';

/**
 * `quad` (its index, position and uv shared, never copied) drawn once per instance: each named per-instance attribute set
 * as given, the instance count the first attribute's (0 without one). A card's baked rows go through it, and so does any
 * caller's own instanced quad cloud (a fire's smoke and sparks seeded per instance).
 */
export function instancedQuad(quad: BufferGeometry, attributes: Readonly<Record<string, InstancedBufferAttribute>>): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.getAttribute('position')); g.setAttribute('uv', quad.getAttribute('uv'));
  let count = -1;
  for (const [name, attribute] of Object.entries(attributes)) {
    if (count < 0) count = attribute.count;
    g.setAttribute(name, attribute);
  }
  g.instanceCount = Math.max(count, 0);
  return g;
}

const envelopes = new WeakMap<object, Box3>();
/**
 * Declare `mesh`'s envelope: a local box over every copy it may ever draw, where a culler fills its copies per view (a
 * culled level starts empty). Draw containment (the grid's cell clip) decides by it once, before the first fill and
 * whichever copies are drawn, so a clipped program is prepared with its cell instead of built at its first draw.
 */
export function setInstanceEnvelope(mesh: InstancedMesh, box: Box3): void { envelopes.set(mesh, box); }
/** `mesh`'s declared envelope (`setInstanceEnvelope`), if any */
export function instanceEnvelope(mesh: object): Box3 | undefined { return envelopes.get(mesh); }
