import * as v from 'valibot';
import type { CollisionMesh } from './collisionStrips';

/** C2 (J28, J91): the road's collision as the server reads it, one file pair per catalogue: each strip's positions and
 *  indices with its placements, the look and the colours dropped. Shapes repeat across the grid, so each is held once. */
export const GRID_COLLISION_HEADER = 'grid/strips.json';
export const GRID_COLLISION_BODY = 'grid/shapes.bin';

const offset = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const point = v.strictObject({ x: v.number(), z: v.number() });
export interface GridCollisionHeader {
  readonly version: 1; readonly source: string;
  readonly shapes: readonly { readonly positions: readonly [number, number]; readonly indices: readonly [number, number] }[];
  readonly strips: readonly { readonly id: string; readonly shape: number; readonly origin: { readonly x: number; readonly z: number }; readonly duplicates: readonly { readonly instance: string; readonly origin: { readonly x: number; readonly z: number } }[] }[];
}
const GridCollisionSchema: v.GenericSchema<GridCollisionHeader> = v.strictObject({
  version: v.literal(1), source: v.string(),
  shapes: v.array(v.strictObject({ positions: v.strictTuple([offset, offset]), indices: v.strictTuple([offset, offset]) })),
  strips: v.array(v.strictObject({ id: v.string(), shape: offset, origin: point, duplicates: v.array(v.strictObject({ instance: v.string(), origin: point })) })),
});

/** One strip's solids: its mesh in the road's world, and each cell's own copy in that cell's world. */
export interface GridCollisionStrip { readonly id: string; readonly mesh: CollisionMesh; readonly duplicates: readonly { readonly instance: string; readonly mesh: CollisionMesh }[] }

/** The strips, with one set of arrays per shape: a strip is immutable, and a world's collider copies what it needs. */
export function readGridCollision(header: unknown, body: Uint8Array): readonly GridCollisionStrip[] {
  const parsed = v.parse(GridCollisionSchema, header), bytes = new Uint8Array(body);
  const shapes = parsed.shapes.map(({ positions, indices }) => {
    if (positions[0] % 4 !== 0 || indices[0] % 4 !== 0 || positions[0] + positions[1] * 4 > bytes.length || indices[0] + indices[1] * 4 > bytes.length) throw new Error('Grid collision shape differs');
    return { positions: new Float32Array(bytes.buffer, positions[0], positions[1]), indices: new Uint32Array(bytes.buffer, indices[0], indices[1]) };
  });
  return parsed.strips.map(({ id, shape, origin, duplicates }) => {
    const arrays = shapes[shape];
    if (arrays === undefined) throw new Error('Grid collision strip differs');
    return { id, mesh: { ...arrays, origin }, duplicates: duplicates.map(row => ({ instance: row.instance, mesh: { ...arrays, origin: row.origin } })) };
  });
}
