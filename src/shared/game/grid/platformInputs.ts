import type { PlatformCell, StripProfile } from '@wildshard/engine/sim/strips';
import type { GridAssembly } from './assembly';

/** The platform's cells: the shards' real edge rows and observations (loaded once by `create`, before this one generation),
 *  and each cell at road level as the fallback. */
export function platformInputs(assembly: GridAssembly, edges: readonly PlatformCell[] | undefined): { readonly cells: readonly PlatformCell[]; readonly flat: readonly PlatformCell[]; readonly empty: StripProfile } {
  const empty = assembly.emptyNeighbour.edge;
  const flat = assembly.cells.map((cell): PlatformCell => ({ instance: cell.instance, cell: cell.cell, origin: { x: cell.origin.x, z: cell.origin.z },
    edges: { north: empty, east: empty, south: empty, west: empty } }));
  return { cells: edges ?? flat, flat, empty };
}
