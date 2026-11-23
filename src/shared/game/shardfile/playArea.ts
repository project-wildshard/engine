// SERVER-PARITY SS6: one fall floor. The page reads a shard's play area from its manifest's bounds, then from the `client/plan`
// rows that override them: `player.enter` replaces them (Sky Reach: floor −8, ±250), `world.runtime-hooks` keeps the authored floor
// near the middle and drops it past a radius (Nine Dragon: −20 past 200 m). A room reads the same rows here, so the two agree.
import type { Bounds } from '@wildshard/engine/level/spec';
import type { ShardFolder } from '@wildshard/engine/game/shardfile/shardFolder';
import { declaredPlayArea as formatPlayArea, type PlayArea } from '@wildshard/format/playArea';

/** SHARD-COMPAT PR6c (J487): the play area is a format rule now; this reads the product's `client/plan` rows for it. */

/** The play area the page selects for `authored` (the manifest's bounds) under the product's `client/plan`, or none. The
 *  runtime hooks install after `player.enter` (phase `world-bindings` after `world`), so theirs wins when a shard has both. */
export function declaredPlayArea(authored: Bounds | undefined, product: Pick<ShardFolder, 'has' | 'section'> | undefined): PlayArea | undefined {
  return formatPlayArea(authored, product?.has('client/plan') === true ? product.section('client/plan').features : []);
}
