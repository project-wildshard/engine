// GC15 (GRID-CROSSING, MP1.6 inside a worker): what a seat's crossing needs of the room it walks into, and the trigger that says it
// has walked. A cell and its worker's road hand a seat to each other through the door (`World.crossing`), on the same socket.
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { NetRoom } from '@wildshard/engine/net/room';
import type { SimNetWorld } from '@wildshard/engine/net/simWorld';
import type { Transport } from '@wildshard/engine/net/transport';
import type { GridAssembly, GridCell, GridPoint } from '@wildshard/engine/game/grid/assembly';
import type { ResumeAt, SeatEntry } from './cellProtocol';

/** How far past a border the feet go before a crossing is asked for, either way, so a seat standing on the line never bounces. */
export const CROSS_MARGIN = 1;

/** A body a room has made for a crossing seat, standing and waiting for its link. */
export interface CrossArrival {
  readonly body: string;
  /** Bind the handed-off client (null: the link dropped on the way, and the seat holds). True when the seat stands here after. */
  land: (client: number | null) => boolean;
}
/** A room a seat can walk into. */
export interface CrossTarget {
  readonly net: NetRoom; readonly sim: SimNetWorld;
  holds: (device: string) => boolean;
  /** Make the body first, at `at` in this room's frame; the reason when it can't, with nothing left behind. */
  admit: (entry: SeatEntry, transport: Transport, at: ResumeAt) => CrossArrival | string;
}
/** Feet the grid can place: a body gone to NaN is skipped, never thrown on, so one bad body can't end its worker. */
export function finite(feet: Readonly<GridPoint>): boolean { return Number.isFinite(feet.x) && Number.isFinite(feet.y) && Number.isFinite(feet.z); }
/** Where a seat's feet have walked: a cell (`cell`) or the road (null), and where they stand in its frame. */
export interface Crossed { readonly cell: GridCell | null; readonly at: GridPoint }

/**
 * The trigger (GC15a list item 3): the cell or road a seat in `here` (null: the road) has walked into, from its feet in that room's
 * frame. A cell's frame is its own (`assembly.local`), the road's is the world's. Undefined while they stay.
 */
export function crossedTo(assembly: GridAssembly, here: GridCell | null, feet: Readonly<GridPoint>): Crossed | undefined {
  if (here !== null) {
    if (Math.abs(feet.x) <= CHUNK_HALF + CROSS_MARGIN && Math.abs(feet.z) <= CHUNK_HALF + CROSS_MARGIN) return undefined;
    const world = assembly.world(feet, here), cell = assembly.at(world.x, world.z);
    return cell === undefined ? { cell: null, at: world } : { cell, at: assembly.local(world, cell) };
  }
  const cell = assembly.at(feet.x, feet.z);
  if (cell === undefined || Math.abs(feet.x - cell.origin.x) > CHUNK_HALF - CROSS_MARGIN || Math.abs(feet.z - cell.origin.z) > CHUNK_HALF - CROSS_MARGIN) return undefined;
  return { cell, at: assembly.local(feet, cell) };
}
