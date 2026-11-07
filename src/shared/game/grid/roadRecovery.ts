/**
 * Road respawn (SHARD-PLATFORM SF17b, G101): *"If you fall to your death you spawn at the road not inside the shard."*
 * The live crossing remembers the last place the traveller stood on the road itself (the 15 m asphalt band of a segment,
 * not the strips beside it). A fall that began from the road (no ground under the feet inside a cell since) recovers
 * there, in a lane, whatever frame the traveller fell into. Recovery belongs to a cell after a grounded entry through
 * its declared opening, or five continuous seconds grounded at least twenty metres inside its edge (G127 / G129).
 *
 * Pure grid metres, no three.js or physics: the caller feeds it the world feet once per fixed step.
 */
import { ROAD_HALF } from './roadLayout';
import { CHUNK_HALF } from '@wildshard/engine/core/config';

/** A road point in grid metres and the heading the traveller had there. */
export interface RoadPoint { readonly x: number; readonly z: number; readonly yaw: number }
/** The grid's road centre lines: `pitch` apart, half a pitch off the cell origins, over the assembled cells' extent. */
export interface RoadGrid { readonly pitch: number; readonly cells: readonly { readonly cell: readonly [number, number] }[] }
/** An admitted cell's entry openings; widths come from its declarations and generated turn-ins. */
export interface RoadRecoveryCell {
  readonly instance: string; readonly origin: { readonly x: number; readonly z: number };
  readonly entryways: readonly { readonly edge: 'north' | 'south' | 'east' | 'west'; readonly width: number }[];
}

/** How far off a centre line still counts as the road (inside the kerbs). */
const ON_ROAD = ROAD_HALF - 0.5;
/** The recovered point sits in the middle of its lane (the lane dividers are at ±3.55 m). */
const LANE = 3.6;
/** Feet within this of road level are on the deck (a cliff top or a dike crest beside it is not). */
const ROAD_LEVEL = 0.6;

/** Signed distance from the nearest road centre line on one axis (centre lines at k·pitch + pitch/2). */
function across(v: number, pitch: number): number { const c = Math.round((v - pitch / 2) / pitch) * pitch + pitch / 2; return v - c; }

function throughEntry(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, cell: RoadRecoveryCell): boolean {
  if (Math.abs(from.y) > ROAD_LEVEL || Math.abs(to.y) > ROAD_LEVEL) return false;
  if (Math.hypot(to.x - from.x, to.z - from.z) > 2) return false; // a respawn/teleport is not a walked entry
  return cell.entryways.some(({ edge, width }) => {
    if (!Number.isFinite(width) || width <= 0) return false;
    const axis = edge === 'east' || edge === 'west' ? 'x' : 'z', along = axis === 'x' ? 'z' : 'x';
    const sign = edge === 'east' || edge === 'north' ? 1 : -1;
    const before = sign * (from[axis] - cell.origin[axis]), after = sign * (to[axis] - cell.origin[axis]);
    if (before < CHUNK_HALF || after >= CHUNK_HALF || before === after) return false;
    const fraction = (before - CHUNK_HALF) / (before - after);
    const lateral = from[along] + fraction * (to[along] - from[along]) - cell.origin[along];
    return Math.abs(lateral) <= width / 2;
  });
}

/** Is a world point on a road segment or junction of this grid (within the kerbs, inside the outer ring)? */
export function onRoad(grid: RoadGrid, x: number, z: number): boolean {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const row of grid.cells) { const value = row.cell[0]; minX = Math.min(minX, value); maxX = Math.max(maxX, value); }
  for (const row of grid.cells) { const value = row.cell[1]; minZ = Math.min(minZ, value); maxZ = Math.max(maxZ, value); }
  const p = grid.pitch;
  const margin = p / 2 + ON_ROAD;
  if (x < minX * p - margin || x > maxX * p + margin || z < minZ * p - margin || z > maxZ * p + margin) return false;
  return Math.abs(across(x, p)) <= ON_ROAD || Math.abs(across(z, p)) <= ON_ROAD;
}

/** The last road point, held until a real cell entry is established. Time advances only with the existing fixed step. */
export class RoadRecovery {
  private readonly grid: RoadGrid;
  private last: RoadPoint | null = null;
  private owner: string | null = null;
  private candidate: string | null = null;
  private groundTicks = 0;
  private previous: { x: number; y: number; z: number; grounded: boolean } | undefined;
  constructor(grid: RoadGrid) { this.grid = grid; }

  /** Once per 60 Hz fixed step: world feet, ground contact, admitted openings, and contact with that shard's own ground. */
  observe(feet: { readonly x: number; readonly y: number; readonly z: number }, yaw: number, grounded: boolean, cell?: RoadRecoveryCell, shardGround: boolean = grounded): void {
    const previous = this.previous; this.previous = { ...feet, grounded };
    if (cell !== undefined) {
      if (this.candidate !== cell.instance) { this.candidate = cell.instance; this.groundTicks = 0; if (this.owner !== cell.instance) this.owner = null; }
      if (this.owner === cell.instance) return;
      if (grounded && previous?.grounded === true && throughEntry(previous, feet, cell)) { this.owner = cell.instance; return; }
      const depth = CHUNK_HALF - Math.max(Math.abs(feet.x - cell.origin.x), Math.abs(feet.z - cell.origin.z));
      this.groundTicks = shardGround && depth >= 20 ? this.groundTicks + 1 : 0;
      if (this.groundTicks >= 300) this.owner = cell.instance;
      return;
    }
    this.candidate = null; this.groundTicks = 0; this.owner = null;
    if (!grounded) return;
    if (Math.abs(feet.y) > ROAD_LEVEL || !onRoad(this.grid, feet.x, feet.z)) return;
    this.owner = null;
    // snap across the road to the middle of the lane the feet were in (never the kerb beside a drop)
    const p = this.grid.pitch, ax = across(feet.x, p), az = across(feet.z, p);
    const lane = (d: number): number => (d < 0 ? -LANE : LANE);
    const alongX = Math.abs(az) <= ON_ROAD && Math.abs(ax) > ON_ROAD; // a segment running along x (its centre line is a z line)
    this.last = alongX ? { x: feet.x, z: feet.z - az + lane(az), yaw } : Math.abs(ax) <= ON_ROAD && Math.abs(az) > ON_ROAD ? { x: feet.x - ax + lane(ax), z: feet.z, yaw } : { x: feet.x, z: feet.z, yaw };
  }

  /** Last grounded road location for recovery reloads, even while a shard owns ordinary death respawn. */
  lastRoad(): RoadPoint | null { return this.last === null ? null : { ...this.last }; }

  /** Where a fall death recovers: the last road point when the fall began from the road, else null (the frame's own rule). */
  target(): RoadPoint | null { return this.owner === null ? this.last : null; }


}
