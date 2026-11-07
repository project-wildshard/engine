/**
 * The boulevard's layout (SHARD-PLATFORM SF17b look, G80 / G81 / G89 / G93): where the roads, junctions, turn-ins,
 * streetlights and distance signs of the grid's deck sit, as plain data in grid metres. No three.js here, so the layout
 * is testable in Node; `roadLook.ts` draws it and `voidLook.ts` draws the void past the outer road.
 *
 * The deck's shape is the generator's (`@wildshard/engine/sim/strips`): between two cells a 62.5 m gap, a 15 m road on the
 * gap's centre line and a 23.75 m strip each side; a junction where four gaps meet. The outer ring is the gap past the
 * outermost cells, and the rail (the void's collision wall) sits on its outer shoulder.
 *
 * Every road segment between two junctions has one turn-in at its midpoint (G93: a shard's four entryways sit at its edge
 * midpoints), so the kerb opens there on each side that has a cell. Sign text is a cell's shard name from the catalogue's
 * slug, never a name written here (an open plot's is its open-plots output's name, G538).
 */
import type { GridAssembly, GridCell } from './assembly';
import { CHUNK_SIZE, CONTENT_CAPS, ENTRY_WIDTH, ENTRY_ASPHALT as entryAsphalt } from '@wildshard/engine/core/config';

/** The road's half width (the generator's flat road band, `STRIP_OFFSETS` ±7.5). */
export const ROAD_HALF = 7.5;
/** Half the 62.5 m gap between two cells (road plus both strips). */
export const GAP_HALF: number = (CONTENT_CAPS.pitch - CHUNK_SIZE) / 2;
/** A road segment's half length (a cell side, from junction to junction). */
export const SEGMENT_HALF = 250;
/** The rail's distance from the outer road's centre line: the road edge plus a 1.5 m gravel shoulder (G89). */
export const RAIL_OFFSET: number = ROAD_HALF + 1.5;
/** A turn-in's half width at a segment midpoint (G93). */
export const TURN_IN_HALF: number = ENTRY_WIDTH / 2;
/** How far each entry carries the platform's neutral asphalt INTO the shard past its cell edge (G103). */
export const ENTRY_ASPHALT: 15 = entryAsphalt;
/** The roundabout's outer kerb radius and its island radius (G81). */
export const RING_OUTER = 15.5;
export const RING_ISLAND = 6;

/** The lifetime a look is disposed with (the session's level scope). */
export interface LookScope { readonly onDispose: (fn: () => void) => void }
/** One road segment: it runs along `axis`, centred at `centre`; `low` is the cell on its negative side, `high` its positive side. */
export interface RoadSegment {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly centre: { readonly x: number; readonly z: number };
  readonly low: GridCell | undefined;
  readonly high: GridCell | undefined;
}
/** A junction and the arms that leave it (east = +x, north = +z). */
export interface RoadJunction {
  readonly id: string;
  readonly centre: { readonly x: number; readonly z: number };
  readonly arms: Readonly<Record<ArmSide, boolean>>;
  /** four arms: a kerbed roundabout (G81); fewer: a plain junction */
  readonly roundabout: boolean;
}
export type ArmSide = 'east' | 'west' | 'north' | 'south';
/** One line of a sign: an arrow, the shard names that way and the distance to their turn-in (null: a turn-in's own name sign). */
export interface SignLine { readonly arrow: 'left' | 'right' | 'ahead'; readonly names: readonly string[]; readonly metres: number | null }
/** A green distance sign: where it stands (grid metres), which way its face looks (unit, horizontal) and its lines. */
export interface RoadSign { readonly at: { readonly x: number; readonly z: number }; readonly facing: { readonly x: number; readonly z: number }; readonly lines: readonly SignLine[] }
/** A streetlight: its foot and the unit direction its arm reaches (toward the road). */
export interface RoadLight { readonly at: { readonly x: number; readonly z: number }; readonly reach: { readonly x: number; readonly z: number } }
/** The rail's square: the outer road's shoulder on every side. */
export interface RailBox { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
/** Everything the look draws. */
export interface RoadLayout {
  readonly segments: readonly RoadSegment[];
  readonly junctions: readonly RoadJunction[];
  readonly signs: readonly RoadSign[];
  readonly lights: readonly RoadLight[];
  readonly rail: RailBox;
}

const ARM: Readonly<Record<ArmSide, { readonly x: number; readonly z: number }>> = { east: { x: 1, z: 0 }, west: { x: -1, z: 0 }, north: { x: 0, z: 1 }, south: { x: 0, z: -1 } };
const SIDES: readonly ArmSide[] = ['east', 'north', 'west', 'south'];
/** A corridor sign stands this far into a segment; a junction's approach sign this far before it. */
const CORRIDOR_SIGN = 200, APPROACH_SIGN = 150, SIGN_SIDE = ROAD_HALF + 2.2;
const round10 = (m: number): number => Math.round(m / 10) * 10;

/** A segment's point at along `s` and across `t` (grid metres). */
export function segmentPoint(segment: RoadSegment, s: number, t: number): { x: number; z: number } {
  return segment.axis === 'z' ? { x: segment.centre.x + t, z: segment.centre.z + s } : { x: segment.centre.x + s, z: segment.centre.z + t };
}
/** The unit vector along a segment's +s. */
function alongUnit(segment: RoadSegment): { x: number; z: number } { return segment.axis === 'z' ? { x: 0, z: 1 } : { x: 1, z: 0 }; }
/**
 * The across sign (t) of a traveller's right-hand side heading `dir` (±1) along the segment (right-hand traffic). Three's
 * frame with north +z and east +x is a mirrored map: heading north your right hand is west (−x), heading east it is +z.
 */
export function rightSide(segment: RoadSegment, dir: 1 | -1): 1 | -1 { return segment.axis === 'x' ? dir : (dir === 1 ? -1 : 1); }

/** The boulevard's layout for an assembly; `name` turns a slug into the shard name signs show. */
export function roadLayout(assembly: GridAssembly, name: (slug: string) => string): RoadLayout {
  const pitch = assembly.pitch, xs = assembly.cells.map((c) => c.cell[0]), zs = assembly.cells.map((c) => c.cell[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const byCell = new Map<string, GridCell>(assembly.cells.map((c) => [c.cell.join(','), c]));
  const at = (x: number, z: number): GridCell | undefined => byCell.get(`${String(x)},${String(z)}`);
  const sideName = (c: GridCell): string => name(c.slug);
  const segments: RoadSegment[] = [], segmentAt = new Map<string, RoadSegment>();
  // gap.x: between columns X and X+1 (runs along z); gap.z: between rows Z and Z+1 (runs along x), as the generator ids them
  for (let x = minX - 1; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const segment: RoadSegment = { id: `gap.x.${String(x)}.${String(z)}`, axis: 'z', centre: { x: x * pitch + pitch / 2, z: z * pitch }, low: at(x, z), high: at(x + 1, z) };
    segments.push(segment); segmentAt.set(segment.id, segment);
  }
  for (let z = minZ - 1; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
    const segment: RoadSegment = { id: `gap.z.${String(x)}.${String(z)}`, axis: 'x', centre: { x: x * pitch, z: z * pitch + pitch / 2 }, low: at(x, z), high: at(x, z + 1) };
    segments.push(segment); segmentAt.set(segment.id, segment);
  }
  const junctions: RoadJunction[] = [];
  const armSegment = new Map<string, RoadSegment>();
  for (let x = minX - 1; x <= maxX; x++) for (let z = minZ - 1; z <= maxZ; z++) {
    const id = `cross.${String(x)}.${String(z)}`;
    const east = segmentAt.get(`gap.z.${String(x + 1)}.${String(z)}`), west = segmentAt.get(`gap.z.${String(x)}.${String(z)}`);
    const north = segmentAt.get(`gap.x.${String(x)}.${String(z + 1)}`), south = segmentAt.get(`gap.x.${String(x)}.${String(z)}`);
    const arms = { east: east !== undefined, west: west !== undefined, north: north !== undefined, south: south !== undefined };
    for (const [side, segment] of [['east', east], ['west', west], ['north', north], ['south', south]] as const) if (segment !== undefined) armSegment.set(`${id}:${side}`, segment);
    junctions.push({ id, centre: { x: x * pitch + pitch / 2, z: z * pitch + pitch / 2 }, arms, roundabout: SIDES.every((side) => arms[side]) });
  }
  const names = (segment: RoadSegment): string[] => [segment.low, segment.high].filter((c): c is GridCell => c !== undefined).map(sideName);
  const signs: RoadSign[] = [];
  // corridor signs (G80): 30 m into a segment, on the right, naming the shards whose turn-in is ahead
  for (const segment of segments) for (const dir of [1, -1] as const) {
    const right = rightSide(segment, dir), s = -dir * CORRIDOR_SIGN, unit = alongUnit(segment), lines: SignLine[] = [];
    for (const [cell, t] of [[segment.low, -1], [segment.high, 1]] as const) if (cell !== undefined) lines.push({ arrow: t === right ? 'right' : 'left', names: [sideName(cell)], metres: round10(CORRIDOR_SIGN) });
    if (lines.length > 0) signs.push({ at: segmentPoint(segment, s, right * SIGN_SIDE), facing: { x: -unit.x * dir, z: -unit.z * dir }, lines });
  }
  // approach signs (G81): one per approach to a junction with three or more arms, a line per way out
  for (const junction of junctions) {
    const present = SIDES.filter((side) => junction.arms[side]);
    if (present.length < 3) continue;
    for (const from of present) {
      const segment = armSegment.get(`${junction.id}:${from}`);
      if (segment === undefined) continue;
      const out = ARM[from], heading = { x: -out.x, z: -out.z }, unit = alongUnit(segment);
      const dir: 1 | -1 = heading.x * unit.x + heading.z * unit.z > 0 ? 1 : -1, right = rightSide(segment, dir);
      const lines: SignLine[] = [];
      for (const side of present) {
        if (side === from) continue;
        const way = ARM[side], arm = armSegment.get(`${junction.id}:${side}`);
        if (arm === undefined) continue;
        const cross = heading.x * way.z - heading.z * way.x; // > 0: a right turn in three's frame (see rightSide)
        const arrow = way.x === heading.x && way.z === heading.z ? 'ahead' : cross > 0 ? 'right' : 'left';
        const list = names(arm);
        if (list.length > 0) lines.push({ arrow, names: list, metres: round10(SEGMENT_HALF - APPROACH_SIGN + pitch / 2) });
      }
      const order = { left: 0, ahead: 1, right: 2 } as const;
      lines.sort((a, b) => order[a.arrow] - order[b.arrow]);
      if (lines.length > 0) signs.push({ at: segmentPoint(segment, dir * APPROACH_SIGN, right * SIGN_SIDE), facing: { x: -heading.x, z: -heading.z }, lines });
    }
  }
  // turn-in signs (G100): a plain T-junction with a green shard-name sign on its far corner, facing the traffic whose
  // right-hand side the entry is on, an arrow into the shard
  for (const segment of segments) for (const [cell, t] of [[segment.low, -1], [segment.high, 1]] as const) {
    if (cell === undefined) continue;
    const dir: 1 | -1 = rightSide(segment, 1) === t ? 1 : -1, unit = alongUnit(segment);
    signs.push({ at: segmentPoint(segment, dir * (TURN_IN_HALF + 3), t * SIGN_SIDE), facing: { x: -unit.x * dir, z: -unit.z * dir }, lines: [{ arrow: 'right', names: [sideName(cell)], metres: null }] });
  }
  // streetlights (G80): every 50 m both sides, never on a void side (the rail is there) nor in a turn-in
  const lights: RoadLight[] = [];
  for (const segment of segments) for (const t of [-1, 1] as const) {
    if (outer(segment, t, minX, maxX, minZ, maxZ, pitch)) continue;
    const reach = segment.axis === 'z' ? { x: -t, z: 0 } : { x: 0, z: -t };
    for (let s = -225; s <= 225; s += 50) lights.push({ at: segmentPoint(segment, s, t * (ROAD_HALF + 1.1)), reach });
  }
  for (const junction of junctions) if (junction.roundabout) lights.push({ at: junction.centre, reach: { x: 0, z: 0 } });
  const rail: RailBox = { minX: minX * pitch - pitch / 2 - RAIL_OFFSET, maxX: maxX * pitch + pitch / 2 + RAIL_OFFSET, minZ: minZ * pitch - pitch / 2 - RAIL_OFFSET, maxZ: maxZ * pitch + pitch / 2 + RAIL_OFFSET };
  return { segments, junctions, signs, lights, rail };
}

/** Is the segment's `t` side the void (past the outermost cells)? */
function outer(segment: RoadSegment, t: -1 | 1, minX: number, maxX: number, minZ: number, maxZ: number, pitch: number): boolean {
  const c = segment.axis === 'z' ? segment.centre.x : segment.centre.z, lo = (segment.axis === 'z' ? minX : minZ) * pitch - pitch / 2, hi = (segment.axis === 'z' ? maxX : maxZ) * pitch + pitch / 2;
  return (t < 0 && Math.abs(c - lo) < 1) || (t > 0 && Math.abs(c - hi) < 1);
}
