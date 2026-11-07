import type { Scope } from '@wildshard/engine/app/scope';

interface Point { readonly x: number; readonly z: number }
const entries = new WeakMap<Scope, Point>();

/** Snapshot the actual crossing approach in destination cell metres. A resident
 * without a crossing keeps its authored spawn as the caller's fallback. */
export function bindResidentTileEntry(owner: Scope, point: Point): void {
  if (owner.disposed || owner.disposing || !Number.isFinite(point.x) || !Number.isFinite(point.z)) throw new Error('Tile entry requires a live owner and finite cell point');
  if (entries.has(owner)) throw new Error('Resident tile entry is already bound');
  entries.set(owner, Object.freeze({ x: point.x, z: point.z }));
}

/** Construction-only entry point; never a new viewer clock or readiness flag. */
export function residentTileEntry(owner: Scope): Point | undefined {
  if (owner.disposed || owner.disposing) throw new Error('Tile entry owner is disposed');
  return entries.get(owner);
}
