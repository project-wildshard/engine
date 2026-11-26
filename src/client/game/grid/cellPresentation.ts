import type { Vector3 } from 'three';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';

type Presented = Pick<RowBodiesView, 'onDamage' | 'onOthersHit' | 'onKill' | 'onSound'>;

/** QA 11-25 row 86: the page's play wires its HUD on its own creatures' manager (Combat's numbers, the kill feed, the
 *  cries), and an entered cell's creatures are another manager, so a grid hit showed no number and a kill no feed line.
 *  While the cell is entered its creatures present through the page's: whatever the cell's manager already said runs first,
 *  and a hit point leaves the region's frame for the world's, where the page's camera projects it. Returns the undo. */
export function presentThrough(cell: Presented, page: Presented, toWorld: (point: Vector3) => Vector3): () => void {
  const own = { onDamage: cell.onDamage, onOthersHit: cell.onOthersHit, onKill: cell.onKill, onSound: cell.onSound };
  cell.onDamage = (animal, amount, point, headshot, died) => { own.onDamage?.(animal, amount, point, headshot, died); page.onDamage?.(animal, amount, toWorld(point), headshot, died); };
  cell.onOthersHit = (animal, amount, point, died) => { own.onOthersHit?.(animal, amount, point, died); page.onOthersHit?.(animal, amount, toWorld(point), died); };
  cell.onKill = animal => { own.onKill?.(animal); page.onKill?.(animal); };
  // a cry is heard against the player, who stands in the region's frame as its creatures do
  cell.onSound = (name, position) => { own.onSound?.(name, position); page.onSound?.(name, position); };
  return () => { Object.assign(cell, own); };
}
