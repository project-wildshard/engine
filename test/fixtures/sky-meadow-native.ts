import { BufferAttribute, Group, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, LOD, type Material, Mesh, Object3D, Sphere, Vector3 } from 'three';
import { skyMeadowView } from '../../src/shards/far-reach/generators/viewData';

const MEADOW = skyMeadowView();

/**
 * The near meadow (loop 4): the baked blades (generators/meadowBlades.ts, world/baked.ts `skyMeadowBlades`) as one level
 * of detail per 8 m chunk, drawn in the `meadow` graph (data/meadowLook.ts): near, every blade and its copies; farther,
 * the blades alone; beyond `range`, nothing. The phone draws each chunk's first (its) blades. Nothing runs per frame.
 */
export function meadow(bytes: Uint8Array | undefined, material: Material | undefined, blades: number): { readonly group: Group; readonly dispose: () => void } {
  const group = new Group(), geometries: InstancedBufferGeometry[] = []; group.name = 'far.meadow';
  const dispose = (): void => { group.removeFromParent(); for (const g of geometries) g.dispose(); };
  if (bytes === undefined || material === undefined || bytes.length < 4) return { group, dispose };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks = view.getUint32(0, true);
  const cards = MEADOW.cards.map(c => ({ card: new BufferAttribute(new Float32Array(c.card), 4), layer: new BufferAttribute(new Float32Array(c.layer), 1), index: new BufferAttribute(new Uint16Array(c.index), 1), position: new BufferAttribute(new Float32Array(c.layer.length * 3), 3) }));
  let at = 4 + chunks * 20;
  for (let i = 0; i < chunks; i++) {
    const o = 4 + i * 20, count = view.getUint32(o + 12, true), drawn = blades >= MEADOW.blades ? count : view.getUint32(o + 16, true);
    const buffer = new InstancedInterleavedBuffer(bytes.subarray(at, at + count * 8), 8); at += count * 8;
    const lod = new LOD(); lod.position.set(view.getFloat32(o, true) + MEADOW.tile / 2, view.getFloat32(o + 8, true), view.getFloat32(o + 4, true) + MEADOW.tile / 2);
    for (const [level, c] of cards.entries()) {
      const g = new InstancedBufferGeometry(); geometries.push(g); g.instanceCount = drawn; g.setIndex(c.index);
      g.setAttribute('position', c.position); g.setAttribute('aCard', c.card); g.setAttribute('aLayer', c.layer);
      g.setAttribute('aBladeA', new InterleavedBufferAttribute(buffer, 4, 0, true)); g.setAttribute('aBladeB', new InterleavedBufferAttribute(buffer, 4, 4, true));
      g.boundingSphere = new Sphere(new Vector3(MEADOW.tile / 2, 1.5, MEADOW.tile / 2), MEADOW.tile);
      const mesh = new Mesh(g, material); mesh.position.set(-MEADOW.tile / 2, 0, -MEADOW.tile / 2);
      lod.addLevel(mesh, level === 0 ? MEADOW.lods[0] : 0);
    }
    lod.addLevel(new Object3D(), MEADOW.lods[1]); group.add(lod);
  }
  return { group, dispose };
}
