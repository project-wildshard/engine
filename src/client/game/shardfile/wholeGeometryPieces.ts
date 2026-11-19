import { BufferAttribute, InstancedMesh, InterleavedBufferAttribute, Matrix4, type Mesh } from 'three';
import * as wholeV from 'valibot';
import { admitNativeWholeGeometry } from '@wildshard/engine/models/nativeGeometry';
import type { WholeGeometryPiece } from '../plugin/geometry';
import { readWholePartition } from '@wildshard/format/wholePartition';

/** A whole piece's partition row and its run lists: format's law (SDK-SPLIT SP5b), the identical defining format reader. */

/** Decode independent render pieces without allocating the whole source's
 * arrays. Every local channel, source ordinal and original matrix is checked.
 * The existing complete reconstruction API retains its completeness guard. */
export function wholeGeometryPieces(nodes: readonly Mesh[]): WholeGeometryPiece[] {
  const result: WholeGeometryPiece[] = [], seen = new Map<string, Set<number>>();
  try {
    for (const node of nodes) {
      const metadata: unknown = node.userData['wholePartition'];
      const row = readWholePartition(metadata);
      const instances: unknown = node.userData['instances64'];
      const pose: unknown = node.userData['matrix64'] ?? (node instanceof InstancedMesh && node.count === 1 && Array.isArray(instances) && instances.length === 1 ? instances[0] : undefined);
      const values = wholeV.parse(wholeV.pipe(wholeV.array(wholeV.pipe(wholeV.number(), wholeV.finite())), wholeV.length(16)), pose);
      const { geometry, channels } = admitNativeWholeGeometry(node, 'borrow', true);
      try {
        if (geometry.groups.length > 0 || Object.keys(geometry.morphAttributes).length > 0) throw new Error('Whole piece needs one plain draw');
        for (const [name, channel] of Object.entries(channels)) {
          const attribute = geometry.getAttribute(name);
          if (attribute === undefined || attribute.count !== row.vertices.length || attribute.itemSize !== channel.itemSize) throw new Error('Whole piece channel layout differs');
        }
        if (new Set(row.vertices).size !== row.vertices.length || row.vertices.some(vertex => vertex >= row.vertexCount)) throw new Error('Whole vertex ordinal outside source');
        if ((row.index === 'none' ? row.vertexCount : row.indexCount) % 3 !== 0) throw new Error('Whole source topology differs');
        const index = geometry.index, count = index?.count ?? geometry.getAttribute('position').count;
        if (count !== row.triangles.length * 3) throw new Error('Whole piece triangle count differs');
        const triangles = seen.get(row.id) ?? new Set<number>(); seen.set(row.id, triangles);
        for (let local = 0; local < count; local++) {
          const at = index === null ? local : index.getX(local), vertex = row.vertices[at];
          if (!Number.isInteger(at) || vertex === undefined) throw new Error('Whole missing triangle vertex');
          if (row.index === 'none' && vertex !== (row.triangles[Math.floor(local / 3)] ?? -1) * 3 + local % 3) throw new Error('Whole non-indexed topology differs');
        }
        for (const triangle of row.triangles) {
          if (triangle >= (row.index === 'none' ? row.vertexCount : row.indexCount) / 3 || triangles.has(triangle)) throw new Error('Whole duplicate or invalid triangle');
          triangles.add(triangle);
        }
        if (row.grid !== undefined) {
          const position = geometry.getAttribute('position'), source = position instanceof InterleavedBufferAttribute ? position.data.array : position.array;
          if (!(source instanceof Int16Array) || position.normalized || position.itemSize !== 3) throw new Error('Whole grid needs Int16 positions');
          const restored = new Float32Array(position.count * 3), origin = row.grid.origin;
          for (let i = 0; i < position.count; i++) for (let axis = 0; axis < 3; axis++) {
            const at = position instanceof InterleavedBufferAttribute ? i * position.data.stride + position.offset + axis : i * 3 + axis;
            restored[i * 3 + axis] = Math.fround((source[at] ?? 0) * row.grid.step + (origin[axis] ?? 0));
          }
          geometry.setAttribute('position', new BufferAttribute(restored, 3));
        }
        result.push({ part: row.id, geometry, matrix: new Matrix4().fromArray(values), vertices: row.vertices, triangles: row.triangles,
          vertexCount: row.vertexCount, indexCount: row.indexCount, layout: JSON.stringify(channels) });
      } catch (error) { geometry.dispose(); throw error; }
    }
    return result;
  } catch (error) { for (const piece of result) piece.geometry.dispose(); throw error; }
}
