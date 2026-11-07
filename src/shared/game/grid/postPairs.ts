/**
 * Post stacks at grid placement (SHARD-PLATFORM SF59 step 4, budget v1 C4-R1-A5 / C7): where two adjacent cells' frames
 * blend across the road between them, both shards' post stacks run, so a cell is admitted only when its stack summed
 * with its heaviest admitted neighbour's still fits the per-pixel budget (`postPairRefusal`). The page records each admitted
 * product's static stack cost (`GridPostCosts`); a cell's admission checks its four neighbours against it. Static: the
 * costs come from the admitted bytes, never runtime sensing. Pure: no three.js, no DOM.
 */
import { postPairRefusal, type PostStackCost } from '@wildshard/format/postStack';
import type { GridAssembly, GridCell, GridSide } from './assembly';

const SIDES: readonly GridSide[] = ['north', 'east', 'south', 'west'];

/** The admitted post stack costs of one page's products, by slug (the template copies share one product, one cost). */
export class GridPostCosts {
  private readonly costs = new Map<string, PostStackCost>();
  /** record an admitted product's stack cost */
  record(slug: string, cost: PostStackCost): void { this.costs.set(slug, cost); }
  /** an admitted product's stack cost (undefined: not admitted on this page yet) */
  get(slug: string): PostStackCost | undefined { return this.costs.get(slug); }
}

/**
 * The refusal for placing `cell` (stack `cost`) beside its neighbours, or null when every adjacent pair fits. Each
 * adjacent cell whose cost `costOf` knows is summed with this one; the heaviest pair's refusal names that neighbour. A side
 * with no cell (an open plot, the sea) or a neighbour not admitted yet adds nothing: that neighbour's own admission checks
 * the pair later, so whichever of two over-budget neighbours is admitted second is refused.
 */
export function gridPostPairRefusal(assembly: Pick<GridAssembly, 'neighbour'>, cell: GridCell, cost: PostStackCost, costOf: (slug: string) => PostStackCost | undefined): string | null {
  let worst: { instance: string; refusal: string; sum: number } | null = null;
  for (const side of SIDES) {
    const next = assembly.neighbour(cell, side);
    if (!('instance' in next)) continue;
    const other = costOf(next.slug);
    if (other === undefined) continue;
    const refusal = postPairRefusal(cost, other);
    const sum = cost.instructions + other.instructions;
    if (refusal !== null && (worst === null || sum > worst.sum)) worst = { instance: next.instance, refusal, sum };
  }
  return worst === null ? null : `${cell.instance} beside ${worst.instance}: ${worst.refusal}`;
}
