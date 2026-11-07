import { BufferAttribute, type BufferGeometry, Float16BufferAttribute } from 'three';

/** Dynamic native oracle evidence. Records contain actual raw triangle words, with multiplicity and winding. */
export interface SlabTriangleProof { count: number; stride: number; layout: string | null; blocks: Uint32Array[] }
export function newSlabTriangleProof(): SlabTriangleProof { return { count: 0, stride: 0, layout: null, blocks: [] }; }
/** Retain literal words, including raw half floats and signed zero; no historical digest or output is pinned. */
export function addSlabTriangles(proof: SlabTriangleProof, geometry: BufferGeometry): void {
  const channels = Object.entries(geometry.attributes).sort(([a], [b]) => a === b ? 0 : a === 'position' ? -1 : b === 'position' ? 1 : a.localeCompare(b)).map(([name, attribute]) => {
    if (!(attribute instanceof BufferAttribute)) throw new Error('Slab oracle needs plain native channels');
    return { name, attribute, width: attribute.itemSize * attribute.array.BYTES_PER_ELEMENT,
      bytes: new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength) };
  });
  const layout = JSON.stringify(channels.map(row => [row.name, row.attribute.array.constructor.name, row.attribute instanceof Float16BufferAttribute,
    row.attribute.itemSize, row.attribute.normalized, row.attribute.gpuType]));
  if (proof.layout !== null && proof.layout !== layout) throw new Error('Slab oracle channel layouts differ');
  const bytes = channels.reduce((sum, row) => sum + row.width, 0), stride = Math.ceil(bytes * 3 / 4), count = geometry.index?.count ?? geometry.getAttribute('position').count;
  if (count % 3 !== 0) throw new Error('Slab oracle needs triangles');
  const block = new Uint32Array(count / 3 * stride), target = new Uint8Array(block.buffer);
  for (let at = 0; at < count; at += 3) {
    let offset = at / 3 * stride * 4;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = geometry.index?.getX(at + corner) ?? at + corner;
      for (const row of channels) {
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= row.attribute.count) throw new Error('Slab oracle index outside source');
        target.set(row.bytes.subarray(vertex * row.width, (vertex + 1) * row.width), offset); offset += row.width;
      }
    }
  }
  proof.count += count / 3; proof.stride = stride; proof.layout = layout; proof.blocks.push(block);
}
function sorted(proof: SlabTriangleProof): { words: Uint32Array; order: Uint32Array } {
  const words = new Uint32Array(proof.count * proof.stride); let offset = 0;
  for (const block of proof.blocks) { words.set(block, offset); offset += block.length; }
  const order = Uint32Array.from({ length: proof.count }, (_, i) => i);
  order.sort((a, b) => {
    for (let lane = 0; lane < proof.stride; lane++) {
      const difference = (words[a * proof.stride + lane] ?? 0) - (words[b * proof.stride + lane] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return { words, order };
}
/** Exact multiset equality, independent of tile/chunk order and without relying on a hash collision assumption. */
export function compareSlabTriangles(expected: SlabTriangleProof, actual: SlabTriangleProof): void {
  if (expected.count !== actual.count || expected.stride !== actual.stride || expected.layout !== actual.layout) throw new Error('Slab triangle count or channel layout differs');
  const before = sorted(expected), after = sorted(actual);
  for (let triangle = 0; triangle < expected.count; triangle++) {
    const a = before.order[triangle], b = after.order[triangle]; if (a === undefined || b === undefined) throw new Error('Slab oracle omits a triangle');
    for (let lane = 0; lane < expected.stride; lane++) if (before.words[a * expected.stride + lane] !== after.words[b * expected.stride + lane])
      throw new Error(`Slab triangle words differ at ${triangle}:${lane}`);
  }
}
