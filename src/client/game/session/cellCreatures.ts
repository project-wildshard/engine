import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';

/** The page's creature callbacks a grid cell's manager hands on: the kill feed, the cries and the wind-up warning. */
export const CELL_CREATURE_CALLBACKS = ['onKill', 'onSound', 'onWindup'] as const;
type Callback = (...args: never[]) => void;

/**
 * QA 11-25 row 86 (c): on the grid the creatures the player meets live in the entered cell's own manager, which the page
 * never wired, so a bear's wind-up had no warning or dodge hint and a cry no sound. Each callback the cell's manager
 * fires now runs the page's too: the page's as it is when it fires (its own chains keep working), after whatever the
 * cell set, before or after this call (an accessor, as Combat's taps are). Wired once per manager.
 */
export function forwardCellCreatures(cell: RowBodiesView, page: RowBodiesView, wired: WeakSet<RowBodiesView>): void {
  if (cell === page || wired.has(cell)) return;
  wired.add(cell);
  for (const key of CELL_CREATURE_CALLBACKS) {
    let own = cell[key] as Callback | undefined;
    const both = (...args: never[]): void => { own?.(...args); (page[key] as Callback | undefined)?.(...args); };
    Object.defineProperty(cell, key, { configurable: true, enumerable: true, get: () => both, set: (next: Callback | undefined) => { own = next; } });
  }
}
