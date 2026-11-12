// SERVER-PARITY SS6: one fall floor. The page reads a shard's play area from its manifest's bounds, then from the `client/plan`
// rows that override them: `player.enter` replaces them (Sky Reach: floor −8, ±250), `world.runtime-hooks` keeps the authored floor
// near the middle and drops it past a radius (Nine Dragon: −20 past 200 m). A room reads the same rows here, so the two agree.
import type { Bounds } from '@wildshard/engine/level/spec';
import type { ShardProduct } from '@wildshard/engine/game/shardfile/shardProduct';

/** A `world.runtime-hooks` play area: its x/z, and the floor past `maxAbsXZ` from the origin. */
export interface RuntimeBoundsRows {
  readonly x: readonly [number, number];
  readonly z: readonly [number, number];
  readonly outer: { readonly maxAbsXZ: number; readonly floor: number };
}

/** The floor at (x, z) under a runtime-hooks area: the authored floor inside `maxAbsXZ`, the outer floor past it. */
export const outerFloor = (rows: RuntimeBoundsRows, authored: number, x: number, z: number): number =>
  Math.max(Math.abs(x), Math.abs(z)) > rows.outer.maxAbsXZ ? rows.outer.floor : authored;

/** Where a player may stand in a shard: an x/z box, and the fall floor at each spot in it. */
export interface PlayArea {
  readonly x0: number; readonly x1: number; readonly z0: number; readonly z1: number;
  readonly floorAt: (x: number, z: number) => number;
}

/** The play area the page selects for `authored` (the manifest's bounds) under the product's `client/plan`, or none. The
 *  runtime hooks install after `player.enter` (phase `world-bindings` after `world`), so theirs wins when a shard has both. */
export function declaredPlayArea(authored: Bounds | undefined, product: Pick<ShardProduct, 'has' | 'section'> | undefined): PlayArea | undefined {
  let enter: Bounds | undefined, hooks: RuntimeBoundsRows | undefined;
  if (product?.has('client/plan') === true) for (const feature of product.section('client/plan').features) {
    if (feature.kind === 'player.enter' && feature.bounds !== undefined) enter = feature.bounds;
    else if (feature.kind === 'world.runtime-hooks' && feature.bounds !== undefined) hooks = feature.bounds;
  }
  if (hooks !== undefined) {
    // the page's hook keeps no area for a level that authors none (`runtimeLevelBounds`)
    if (authored === undefined) return undefined;
    const rows = hooks, { floor } = authored;
    return { x0: rows.x[0], x1: rows.x[1], z0: rows.z[0], z1: rows.z[1], floorAt: (x, z) => outerFloor(rows, floor, x, z) };
  }
  const bounds = enter ?? authored;
  if (bounds === undefined) return undefined;
  const { x0, x1, z0, z1, floor } = bounds;
  return { x0, x1, z0, z1, floorAt: () => floor };
}
