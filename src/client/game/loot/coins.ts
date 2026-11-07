/**
 * What a kill is worth in doubloons (E314 L1, Jake's pick board 1 A): coins come only from kills, and only on a shard
 * whose ShardManifest says `loot: { coins: true }` (Driftwood today). First-guess values, tuned after a playthrough (a run
 * earns ~60–100; the trader's goods cost 15–50, project/archive/2026-09-30-driftwood-loot.md). No deer: Jake cut them from Driftwood
 * (their removal is a later pass), so they pay nothing meanwhile.
 *
 *   coinsFor(chunk, a.kind)   → 0 on a shard without coins, or a creature that pays nothing
 *   burstCount(n)             → how many coin meshes fly (a big purse is split over fewer coins)
 */
import { rollLoot } from './tables';
import { coinValue } from '../../../shared/game/loot/coinAmounts';

/** the ShardManifest part the coins read (kept structural so tests and node-side code need no full def) */
export interface LootGate { loot?: { coins?: boolean } | undefined }

export const coinsOn = (def: LootGate): boolean => def.loot?.coins === true;

export function coinsFor(def: LootGate, kind: string): number {
  if (!coinsOn(def)) return 0;
  return coinValue(rollLoot('coins', { kind }, () => 0));
}
