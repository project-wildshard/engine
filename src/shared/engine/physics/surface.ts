/**
 * What every collider is made of and who owns it (PHYSICS.md §Architecture). Queries return this with a hit, so a bolt
 * knows to stick in planks and glance off stone, a footstep knows its sound, and a hit knows which animal / door /
 * pickup it touched. The material names extend the footstep system's `GroundSurface` (src/client/engine/audio/surface.ts).
 *
 * `ground` is the terrain heightfield: its material is not one value, so a query classifies it by position
 * (the level's step map); `edge` is the invisible chunk wall.
 */
import type { Collider } from '@dimforge/rapier3d-simd';
import type { GroundSurface } from '../../../client/engine/audio/surface';

/** `felt` (a yurt's walls) and `earth` (a kurgan's turf, a kokpar goal mound): Nalati's soft surfaces — arrows stick, blades thud */
export type Material = GroundSurface | 'wood' | 'metal' | 'flesh' | 'shell' | 'ground' | 'edge' | 'felt' | 'earth';

export interface ColliderTag { material: Material; owner: unknown }

// Rapier's canonical Collider wrappers are world-local; numeric handles repeat in independent hosts.
const tags = new WeakMap<Collider, ColliderTag>();
const terrain = new WeakSet<Collider>();

/** Classify at registration, outside Rapier's borrowed native query callbacks. */
export function tagCollider(c: Collider, material: Material, owner: unknown = null): void {
  tags.set(c, { material, owner });
  if (material === 'ground' && c.heightfieldNRows() > 0) terrain.add(c); else terrain.delete(c);
}

export function tagOf(c: Collider): ColliderTag | undefined { return tags.get(c); }
/** JS-only query: native controller predicates cannot reborrow Rapier's collider set. */
export function isTerrainCollider(c: Collider): boolean { return terrain.has(c); }

export function untagCollider(c: Collider): void { tags.delete(c); terrain.delete(c); }
