import type {PackedGeometryRows} from '@wildshard/format/geometryPack';

/** The grid page's geometry pack: each strip's original indexed words, in the layout `GeometryPackData` reads and
 *  `GeometryPackWriter` (sharddev) writes for an indexed geometry: every block padded to 4 bytes. */
export class StripPackWriter {
  private readonly packed: PackedGeometryRows['geometries'][number][] = [];
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  /** Append one strip's mesh; returns its index in the pack. */
  add(positions: Float32Array, colours: Float32Array, indices: Uint32Array): number {
    const count = positions.length / 3;
    for (const block of [positions.subarray(0, count * 3), colours.subarray(0, count * 3), indices]) this.push(new Uint8Array(block.slice().buffer));
    this.packed.push({attrs: [['position', 3], ['color', 3]], count, unique: count, own: 'u32', indexCount: indices.length});
    return this.packed.length - 1;
  }

  rows(): PackedGeometryRows { return {bytes: this.size, geometries: [...this.packed]}; }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const chunk of this.chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  }

  private push(bytes: Uint8Array): void {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4); padded.set(bytes);
    this.chunks.push(padded); this.size += padded.length;
  }
}
