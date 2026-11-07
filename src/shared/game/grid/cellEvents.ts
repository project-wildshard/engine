import type { GridCellRef } from '../../../client/game/plugin/context';

/**
 * The seam for inside-cell enter / leave notifications (SF46's hybrid runtime activation consumes them; the grid client
 * produces them). Today's home-cell boot enters its one cell at boot and never leaves it; the grid client calls
 * `enter` / `leave` as the player's frame crosses cell interiors. A late subscriber hears `enter` for the current cell.
 */
export class GridCellEvents {
  private current: GridCellRef | null = null;
  private readonly entered = new Set<(cell: GridCellRef) => void>();
  private readonly left = new Set<(cell: GridCellRef) => void>();
  /** the cell interior the player is in now (null on a strip, the highway, or outside the grid) */
  get cell(): GridCellRef | null { return this.current; }
  /** producer: the player entered a cell interior (leaving the previous one first) */
  enter(cell: GridCellRef): void {
    if (this.current?.instance === cell.instance) return;
    if (this.current !== null) this.leave();
    this.current = cell;
    for (const fn of this.entered) fn(cell);
  }
  /** producer: the player left the current cell interior */
  leave(): void {
    const was = this.current;
    if (was === null) return;
    this.current = null;
    for (const fn of this.left) fn(was);
  }
  /** consumer: returns the unsubscribe */
  onEnter(fn: (cell: GridCellRef) => void): () => void {
    this.entered.add(fn);
    if (this.current !== null) fn(this.current);
    return () => { this.entered.delete(fn); };
  }
  onLeave(fn: (cell: GridCellRef) => void): () => void { this.left.add(fn); return () => { this.left.delete(fn); }; }
}
/** this page's cell events (grid mode only ever enters cells) */
export const pageGridCells: GridCellEvents = new GridCellEvents();
