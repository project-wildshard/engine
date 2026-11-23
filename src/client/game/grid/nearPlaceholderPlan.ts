import { CHUNK_HALF } from '@wildshard/format/contentBounds';
import type { GridCell } from '../../../shared/game/grid/assembly';

/** Round 39 (Jake's phone, G607 D): the phone tier draws this many cells near, the nearest; the rest stay on their far
 *  proxies (D's look: no haze, no fade). Every cell near held 2.1 GB of renderer memory on the phone tier. */
export const PHONE_NEAR_CELLS = 4;
/** A held cell ranks this many metres nearer, so two cells at nearly the same distance don't swap every step. */
export const NEAR_HOLD_MARGIN = 15;
/** A visual-only streaming request; no simulation, collision or save state enters this plan. */
export interface NearPlaceholderPlan {
  /** every cell but the entered and skipped ones, nearest first */
  readonly cells: readonly { readonly instance: string; readonly distance: number }[];
}
/** What the plan should keep (held: drawn or loading now) or pass over (skip: no near placeholder to draw). */
export interface NearPlanOptions {
  readonly held?: ReadonlySet<string>; readonly skip?: ReadonlySet<string>;
  /** at most this many cells, the nearest (absent: every cell) */
  readonly limit?: number;
  /** J500 rule 3: a cell whose square is within this many metres stays in the plan past `limit` (`nearReach`) */
  readonly reach?: number;
}

/**
 * J500 rule 3 (Jake, 2026-11-23 ~13:05 Cancún: the far placeholder is only for zones that are genuinely far): the metres from
 * a cell's content square within which its far proxy is never drawn, one road cell (the road between two cells, its
 * diagonal at a crossing). Jake's Dunes clip showed a far proxy as a flat brown wedge at arm's length, Nalati's as a grey wall
 * across the road.
 */
export function nearReach(pitch: number): number { return (pitch - CHUNK_HALF * 2) * Math.SQRT2; }
/**
 * J500 rule 3 is on: rule 2 (the zone ahead built before its gate) and rule 1 (the zone just left kept) draw the real zone in
 * that slot from the road (`LiveGridHost.drawnFromRoad`). Alone, hiding the far proxy left empty sky where the neighbour
 * stands (coordinator, 2026-11-23). The device slot `debug.farNearReach: false` turns it off.
 */
export function farNearReachOn(saved: unknown): boolean { return saved !== false; }
/** Whether a cell's far proxy (and its haze band) may draw with the eye `distance` metres from its content square. */
export function farDrawnAt(distance: number, pitch: number): boolean { return distance > nearReach(pitch); }

/** Metres from `point` to the cell's content square (0 inside it). */
function squareDistance(cell: GridCell, point: Readonly<{ x: number; z: number }>): number {
  return Math.hypot(Math.max(0, Math.abs(point.x - cell.origin.x) - CHUNK_HALF), Math.max(0, Math.abs(point.z - cell.origin.z) - CHUNK_HALF));
}

/**
 * G607 (Jake's round-36 D, after G371): every cell on its near view, ranked by its content square's distance from the eye
 * (the drawn camera, so a lifted or free camera plans from where it looks), then by its centre's distance, then its
 * instance, with the entered cell and the `skip` cells left out, at most `limit` of them; the order is the streaming order.
 */
export function planNearPlaceholders(cells: readonly GridCell[], pitch: number,
  point: Readonly<{ x: number; z: number }>, entered: string | null, options: NearPlanOptions = {}): NearPlaceholderPlan {
  if (!Number.isFinite(pitch) || pitch <= CHUNK_HALF * 2 || !Number.isFinite(point.x) || !Number.isFinite(point.z))
    throw new RangeError('Invalid near-placeholder coordinates');
  const identities = new Set<string>(), addresses = new Set<string>();
  for (const cell of cells) {
    const address = cell.cell.join(',');
    if (cell.instance.length === 0 || identities.has(cell.instance) || addresses.has(address) ||
      !cell.cell.every(Number.isSafeInteger) || cell.origin.x !== cell.cell[0] * pitch || cell.origin.z !== cell.cell[1] * pitch)
      throw new RangeError('Invalid near-placeholder cell');
    identities.add(cell.instance); addresses.add(address);
  }
  const held = options.held ?? new Set<string>(), skip = options.skip ?? new Set<string>();
  const ranked = cells.filter(cell => cell.instance !== entered && !skip.has(cell.instance)).map(cell => {
    const distance = squareDistance(cell, point);
    return { instance: cell.instance, distance, rank: held.has(cell.instance) ? distance - NEAR_HOLD_MARGIN : distance,
      centre: Math.hypot(point.x - cell.origin.x, point.z - cell.origin.z) };
  });
  ranked.sort((a, b) => a.rank - b.rank || a.centre - b.centre || a.instance.localeCompare(b.instance));
  const limit = options.limit ?? ranked.length, reach = options.reach ?? -1;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError('Invalid near-placeholder limit');
  return { cells: ranked.filter((cell, index) => index < limit || cell.distance <= reach).map(({ instance, distance }) => ({ instance, distance })) };
}


/** Placeholder suppression belongs only to unentered cells. An entered region
 * keeps its tiles even when it has no near view or shared tile registration. */
export function placeholderBlocksTiles(instance:string,entered:string|null,registered:boolean,ownsNear:boolean,absentNear:boolean):boolean {
  return instance!==entered&&!registered&&(ownsNear||absentNear);
}

/** DL17 (G872) with D189: the cell the player is in, drawn by its regional runtime, skips its tile-view admission only when
 *  that runtime draws its own ground, through the tile registration (`registered`) or its manifest's `cellGround: 'world'`.
 *  A runtime whose ground is the cell's ring tiles (Pine) admits them like any neighbour: skipped, its far proxy stayed over
 *  the spawn and its ground never drew. */
export function admitsCellTiles(instance:string,drawn:string|null,registered:boolean,ownGround:boolean):boolean {
  return instance!==drawn||(!registered&&!ownGround);
}
