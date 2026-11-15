import { CHUNK_HALF, ENTRY_WIDTH } from '@wildshard/engine/core/config';
import type { ReadinessEdge } from '@wildshard/engine/physics/readinessWalls';
import type { GridCell } from './assembly';

/**
 * ZONE-ENTRY ZE5 (J352, Jake 2026-11-15: "high walls, impermeable walls. The only places you can enter a cell are the four road
 * entrances [...] a 10-meter buffer going into the zone. So the actual physical wall is going to be 10 meters in"): the wall round
 * every cell but the home. It stands on the cell's edge line, open only at its four entryways, where it steps 10 m in: two side
 * walls along the entry asphalt's sides and the gate across its inner end. The pocket between them is the buffer, floored by the
 * entry socket. Each piece is a readiness edge (`ReadinessWalls`), as tall as a cell (`CELL_ABOVE` over `CELL_BELOW`), so no jump,
 * boost or fall clears it. The page and the server's road (ZE6) lay the same lines; the home is never walled.
 */
/** How far the gate stands inside the cell's edge: the buffer's depth. */
export const BUFFER_DEPTH = 10;
/** A wall's half thickness, as `ReadinessWalls` builds it. */
const HALF_THICK = 0.25;

/** Which piece of a cell's wall an edge is. */
export type ZoneWallPart = 'edge' | 'side' | 'gate';
/** A wall piece with its part and its side of the cell. */
export interface ZoneWallEdge extends ReadinessEdge { readonly part: ZoneWallPart; readonly side: 'north' | 'east' | 'south' | 'west' }

const SIDES = [{ side: 'north', x: 0, z: 1 }, { side: 'east', x: 1, z: 0 }, { side: 'south', x: 0, z: -1 }, { side: 'west', x: -1, z: 0 }] as const;

/** The wall round `cell`, in the frame whose origin is `home.origin`: per side two edge runs either side of the entryway, two
 *  buffer sides and the gate. Every piece's inner face is on the cell's line (the edge) or the buffer's (sides, gate). */
export function zoneWallEdges(cell: GridCell, home: Readonly<{ origin: Readonly<{ x: number; z: number }> }>): ZoneWallEdge[] {
  const cx = cell.origin.x - home.origin.x, cz = cell.origin.z - home.origin.z, open = ENTRY_WIDTH / 2;
  const edges: ZoneWallEdge[] = [];
  for (const { side, x: nx, z: nz } of SIDES) {
    // `across` runs out of the cell through this side, `along` runs along it; a wall facing x (axis 'x') is thin in x
    const facing: 'x' | 'z' = nx !== 0 ? 'x' : 'z', running: 'x' | 'z' = facing === 'x' ? 'z' : 'x';
    const at = (across: number, along: number): { x: number; z: number } => facing === 'x' ? { x: cx + nx * across, z: cz + along } : { x: cx + along, z: cz + nz * across };
    const piece = (part: ZoneWallPart, axis: 'x' | 'z', across: number, along: number, halfLength: number): ZoneWallEdge =>
      ({ instance: cell.instance, ...at(across, along), axis, halfLength, floor: 0, part, side });
    // the edge line either side of the opening, past the corner by a wall's thickness so two sides meet with no gap
    const run = (CHUNK_HALF + 2 * HALF_THICK - open) / 2, mid = open + run;
    edges.push(piece('edge', facing, CHUNK_HALF + HALF_THICK, mid, run), piece('edge', facing, CHUNK_HALF + HALF_THICK, -mid, run));
    // the buffer's two sides, from the gate's back face out to the edge line's outer face, just outside the 8 m asphalt
    const depth = (BUFFER_DEPTH + 4 * HALF_THICK) / 2, centre = CHUNK_HALF + 2 * HALF_THICK - depth;
    edges.push(piece('side', running, centre, open + HALF_THICK, depth), piece('side', running, centre, -(open + HALF_THICK), depth));
    // the gate across the buffer's inner end, its face BUFFER_DEPTH in from the edge
    edges.push(piece('gate', facing, CHUNK_HALF - BUFFER_DEPTH - HALF_THICK, 0, open + 2 * HALF_THICK));
  }
  return edges;
}

/** The cells a page walls: every cell but its home. */
export function walledCells<Cell extends Readonly<{ instance: string }>>(assembly: Readonly<{ cells: readonly Cell[] }>, home: Readonly<{ instance: string }>): Cell[] {
  return assembly.cells.filter(cell => cell.instance !== home.instance);
}
