import { BufferAttribute, InstancedMesh, InterleavedBufferAttribute, Matrix4, type Mesh } from 'three';
import * as wholeV from 'valibot';
import { admitNativeWholeGeometry } from '@wildshard/engine/models/nativeGeometry';
import type { WholeGeometryPiece } from '../plugin/geometry';

/** A run list expands to at most this many ordinals (a 2 MB GLB JSON chunk cannot otherwise bound it). */
const WHOLE_ORDINALS_MAX = 1 << 24;
const WholeOrdinal = wholeV.pipe(wholeV.number(), wholeV.integer(), wholeV.minValue(0));
/** Ordinals as a plain list, or the baker's run-length form `{ runs: [start, length, …] }` (sharddev/bake/props `wholePartitionRuns`). */
/** A plain ordinal list, checked in one loop with WholeOrdinal's rules (valibot's per-element pipe over whole tiles' lists
 *  was ~150 ms of a phone-tier home region) */
const isOrdinals = (list: unknown): list is number[] => Array.isArray(list) && list.every((ordinal: unknown) => typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0);
interface WholeOrdinalValues { readonly values: number[]; readonly length: number; readonly dense: boolean }
function explicitWholeOrdinals(values: number[]): WholeOrdinalValues {
  // Explicit caller arrays retain their original reference and live length.
  return { values, get length(): number { return values.length; }, dense: false };
}
function runWholeOrdinals(runs: number[]): WholeOrdinalValues {
  let values: number[] | undefined;
  const length = runs.reduce((sum, ordinal, i) => sum + (i % 2 === 1 ? ordinal : 0), 0);
  return { length, dense: runs.length === 2 && runs[0] === 0, get values(): number[] {
    if (values === undefined) {
      values = [];
      for (let i = 0; i < runs.length; i += 2) { const start = runs[i] ?? 0, count = runs[i + 1] ?? 0; for (let k = 0; k < count; k++) values.push(start + k); }
    }
    return values;
  } };
}
const WholeOrdinals = wholeV.union([wholeV.pipe(wholeV.custom<number[]>(isOrdinals, 'whole ordinals are non-negative integers'),
  wholeV.transform(explicitWholeOrdinals)), wholeV.pipe(wholeV.strictObject({ runs: wholeV.array(WholeOrdinal) }),
  wholeV.check(row => row.runs.length % 2 === 0 && row.runs.every((ordinal, i) => i % 2 === 0 || ordinal > 0)
    && row.runs.reduce((sum, ordinal, i) => sum + (i % 2 === 1 ? ordinal : 0), 0) <= WHOLE_ORDINALS_MAX, 'whole ordinal runs are bounded start/length pairs'),
  wholeV.transform(row => runWholeOrdinals(row.runs)))]);
const WholePartition = wholeV.pipe(wholeV.strictObject({ id: wholeV.string(), vertices: WholeOrdinals, triangles: WholeOrdinals, vertexCount: wholeV.pipe(wholeV.number(), wholeV.integer(), wholeV.minValue(1)), indexCount: wholeV.pipe(wholeV.number(), wholeV.integer(), wholeV.minValue(0)), index: wholeV.picklist(['none', 'u16', 'u32']),
  // I3: the partition's positions are unnormalized Int16 on this grid of its whole shape (sharddev/bake/props `wholeGrid`)
  grid: wholeV.exactOptional(wholeV.strictObject({ origin: wholeV.tuple([wholeV.number(), wholeV.number(), wholeV.number()]), step: wholeV.pipe(wholeV.number(), wholeV.minValue(1 / 4096), wholeV.maxValue(1)) })) }),
  // The proof lives only in this parsed row: caller-owned explicit arrays
  // never qualify, even when they currently look like a complete run.
  wholeV.transform(row => ({ ...row, get vertices(): number[] { return row.vertices.values; },
    get vertexLength(): number { return row.vertices.length; }, get triangles(): number[] { return row.triangles.values; },
    get triangleLength(): number { return row.triangles.length; }, denseVertices: row.vertices.dense, denseTriangles: row.triangles.dense })));
/** Admitted partition lanes retain their existing lazy ordinal expansion. */
export interface WholePartitionRow {
  readonly id: string; readonly vertices: number[]; readonly triangles: number[];
  readonly vertexCount: number; readonly indexCount: number; readonly index: 'none' | 'u16' | 'u32';
  readonly grid?: { readonly origin: [number, number, number]; readonly step: number };
  readonly vertexLength: number; readonly triangleLength: number; readonly denseVertices: boolean; readonly denseTriangles: boolean;
}
/** The same bounded ordinal grammar for partial and complete whole intake. */
export function readWholePartition(input: unknown): WholePartitionRow { return wholeV.parse(WholePartition, input); }

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
