import type { WaterBody } from './body';
import { waterExtent, waveHeight } from '../waves';
import { SHORE_REVETMENT_INNER_FACE } from '../../sim/shore';
import { insidePolygon } from '../yawFrame';
import { CHUNK_HALF, ENTRY_WIDTH, ENTRY_ASPHALT } from '../../core/config';

/** Canonical entryway exclusions; they remove water across the entire platform socket, not an authored sample point. */
export type DryEntryEdge = 'north' | 'east' | 'south' | 'west';
/** Pure water clipping shared by body admission and the renderer's data adapter. */
export function dryEntryContains(edge: DryEntryEdge, x: number, z: number): boolean {
  switch (edge) {
    case 'north': return Math.abs(x) <= ENTRY_WIDTH / 2 && z >= CHUNK_HALF - ENTRY_ASPHALT && z <= CHUNK_HALF;
    case 'south': return Math.abs(x) <= ENTRY_WIDTH / 2 && z >= -CHUNK_HALF && z <= -CHUNK_HALF + ENTRY_ASPHALT;
    case 'east': return Math.abs(z) <= ENTRY_WIDTH / 2 && x >= CHUNK_HALF - ENTRY_ASPHALT && x <= CHUNK_HALF;
    case 'west': return Math.abs(z) <= ENTRY_WIDTH / 2 && x >= -CHUNK_HALF && x <= -CHUNK_HALF + ENTRY_ASPHALT;
    default: throw new Error('Invalid dry entryway');
  }
}

/** One bounded water region in the shard's local frame; stream point heights describe a sloping rest surface. */
export type WaterDeclaration = (
  | { id: string; kind: 'pool'; level: number; shape: { kind: 'circle'; x: number; z: number; radius: number } | { kind: 'polygon'; points: readonly (readonly [number, number])[] } }
  | { id: 'sea'; kind: 'sea'; level: number; waves: boolean }
  | { id: string; kind: 'stream'; width: number; points: readonly { x: number; z: number; level: number; under?: string | undefined }[];
      levels?: Readonly<Record<string, number>> | undefined }
) & { dryEntries?: readonly DryEntryEdge[] | undefined };

const LIVE = new Map<string, number>();
/**
 * Move a live water level (a stream's `levels` row, named by its points' `under`): a stream point under it rests at the higher
 * of its own level and this one, so a draining pool lowers its stretch of the creek for wading and the dry-ground test.
 * Names are machine-wide; a shard names its own (its slug first). Unset, a level rests at its declared value.
 */
export function setLiveWaterLevel(name: string, level: number): void {
  if (!Number.isFinite(level)) throw new Error(`Invalid live water level ${name}`);
  LIVE.set(name, level);
}

/** Compile validated data into the existing swim/wade port, with no renderer or import-time registration. A sea stops
 *  at the shore revetment's inner face when a grid cell confines the water (`waterExtent`; unbounded standalone). */
export function declaredWaterBody(input: WaterDeclaration): WaterBody {
  const data = structuredClone(input);
  const level = data.kind === 'stream' ? data.points[0]?.level ?? 0 : data.level;
  // Keep lookup metadata in the body; every sample still reads live levels.
  const rest = data.kind === 'stream' ? data.levels : undefined;
  // FC16: each stream segment's box widened by half the stream's width (min x, max x, min z, max z). A point outside it is
  // farther than that from the segment, which can then never be the answer: skipped without its distance (the player's and
  // every animal's dry-ground test asked every segment of Pine's creek)
  const reach = data.kind === 'stream' ? data.width / 2 : 0, boxes = new Float64Array(data.kind === 'stream' ? Math.max(0, data.points.length - 1) * 4 : 0);
  let left = Infinity, right = -Infinity, back = Infinity, front = -Infinity;
  if (data.kind === 'stream') for (let i = 1; i < data.points.length; i++) {
    const a = data.points[i - 1], b = data.points[i]; if (a === undefined || b === undefined) continue;
    const x0 = Math.min(a.x, b.x) - reach, x1 = Math.max(a.x, b.x) + reach;
    const z0 = Math.min(a.z, b.z) - reach, z1 = Math.max(a.z, b.z) + reach;
    boxes.set([x0, x1, z0, z1], (i - 1) * 4);
    left = Math.min(left, x0); right = Math.max(right, x1);
    back = Math.min(back, z0); front = Math.max(front, z1);
  }
  // Outside this Z band no polygon edge can cross the query ray. Retain the
  // original X/intersection arithmetic, including its exact edge decisions.
  if (data.kind === 'pool' && data.shape.kind === 'polygon') for (const point of data.shape.points) {
    if (point === undefined) continue;
    back = Math.min(back, point[1]); front = Math.max(front, point[1]);
  }
  const restAt = (x: number, z: number): number | null => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 250 || Math.abs(z) > 250) return null;
    const edges = data.dryEntries;
    if (edges !== undefined) for (let i = 0; i < edges.length; i++) {
      if (!(i in edges)) continue;
      const edge = edges[i];
      if (edge === undefined) throw new Error('Invalid dry entryway');
      if (dryEntryContains(edge, x, z)) return null;
    }
    if (data.kind === 'sea') return Math.max(Math.abs(x), Math.abs(z)) <= waterExtent.uWaterHalf.value - SHORE_REVETMENT_INNER_FACE ? data.level : null;
    if (data.kind === 'pool') {
      const shape = data.shape;
      if (shape.kind === 'circle') return Math.hypot(x - shape.x, z - shape.z) < shape.radius ? data.level : null;
      if (z < back || z > front) return null;
      return insidePolygon(shape.points, x, z) ? data.level : null;
    }
    // A point outside the union's bounds fails every existing segment-box
    // check below. Live heights, nearest ties and interpolation stay unchanged.
    if (x < left || x > right || z < back || z > front) return null;
    let distance = Infinity, height = level;
    for (let i = 1; i < data.points.length; i++) {
      const a = data.points[i - 1], b = data.points[i]; if (a === undefined || b === undefined) continue;
      const k = (i - 1) * 4;
      if (x < (boxes[k] ?? -Infinity) || x > (boxes[k + 1] ?? Infinity) || z < (boxes[k + 2] ?? -Infinity) || z > (boxes[k + 3] ?? Infinity)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, n = dx * dx + dz * dz;
      const t = n === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / n));
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
      if (d < distance) {
        distance = d;
        // Keep scalars in this query instead of returning boxed numbers from a
        // shared endpoint closure on each segment. Evaluation order stays a, b.
        const from = a.under === undefined ? a.level : Math.max(a.level, LIVE.get(a.under) ?? rest?.[a.under] ?? a.level);
        const to = b.under === undefined ? b.level : Math.max(b.level, LIVE.get(b.under) ?? rest?.[b.under] ?? b.level);
        height = from + (to - from) * t;
      }
    }
    return distance < data.width / 2 ? height : null;
  };
  const surfaceAt = (x: number, z: number): number => !Number.isFinite(x) || !Number.isFinite(z) ? level : (restAt(x, z) ?? level) + (data.kind === 'sea' && data.waves ? waveHeight(x, z) : 0);
  return { id: data.id, level, restAt, surfaceAt, ...(data.kind === 'sea' && data.waves ? { swellAt: (x: number, z: number, seconds: number) => waveHeight(x, z, seconds) } : {}),
    inside: (x, z, y) => Number.isFinite(y) && restAt(x, z) !== null && y < surfaceAt(x, z) };
}
