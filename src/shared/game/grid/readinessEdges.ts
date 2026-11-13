import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { ReadinessEdge } from '@wildshard/engine/physics/readinessWalls';
import type { GridCell } from './assembly';

/** Closed barriers stay outside the cell while allowing the capsule's feet to reach the 6 m admission trigger. */
export function neighbourEdges(cell: GridCell, home: Readonly<{ origin: Readonly<{ x: number; z: number }> }>): ReadinessEdge[] {
  // Wall half-width (0.25), player radius (0.38) and KCC skin (0.02) stop
  // feet before a wall's centre. Leave one metre inside the logical trigger;
  // the closed wall remains five metres outside the authored cell boundary.
  const x = cell.origin.x - home.origin.x, z = cell.origin.z - home.origin.z, r = CHUNK_HALF + 5, halfLength = CHUNK_HALF + 6;
  const edge = (ex: number, ez: number, axis: 'x' | 'z'): ReadinessEdge => ({ instance: cell.instance, x: ex, z: ez, axis, halfLength, floor: 0 });
  return [edge(x + r, z, 'x'), edge(x - r, z, 'x'), edge(x, z + r, 'z'), edge(x, z - r, 'z')];
}
