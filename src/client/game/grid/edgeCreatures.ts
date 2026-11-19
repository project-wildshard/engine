// MMO-PLAN MP5.2b (Q36 under zone entry, J352/J353): on the road a page holds its home and nothing else, and the road's room shows it
// the home's creatures within 60 m inside the home edge (the server's `edgeRows.ts`). Such a row says its place in the road's frame, the
// world's, as `roadX`/`roadZ` (wire 1.3), past `x`/`z`'s ±260 m. The page draws it in the home's own creature manager, whose bodies stand in
// the home's own metres, so the place is moved by the home's origin. A road row is read-only: no body stands for it in the road's world,
// so it never joins the predicted world as a capsule.

import { roadPlaceOf } from '@wildshard/engine/net/netSchemas';

/**
 * Where a page draws a creature row in the manager it spawns into. In a cell (`home` null) a row's own `x`/`z` are that cell's metres.
 * On the road (`home` its home's origin in the world's frame) only a road place is drawn, moved into the home's metres; a row without one
 * is not this page's to draw.
 */
export function drawnPlace(row: { readonly x: number; readonly z: number; readonly roadX?: number; readonly roadZ?: number }, home: { readonly x: number; readonly z: number } | null): { readonly x: number; readonly z: number } | null {
  if (home === null) return { x: row.x, z: row.z };
  const road = roadPlaceOf(row.roadX, row.roadZ);
  return road === null ? null : { x: road.x - home.x, z: road.z - home.z };
}
