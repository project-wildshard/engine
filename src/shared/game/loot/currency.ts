/**
 * ONE-FORMAT OF31g2 (Q37): a shard's one currency (its coin's name, pickup model and Bag icon) is its `economy/loot`
 * row's `currency` (format 0.67.0), not engine code. Driftwood's doubloon was the engine's until OF31g3 declares it.
 *
 *   declaredCurrency(source.rows.loot)   // → { id, name, model, icon } or null when no row names one
 *   coinsDeclared(source.rows.loot)      // the purse and kill bursts are on: a declared currency, or (until OF31g4) any loot row
 */
import * as v from 'valibot';
import { LootEconomySchema } from '@wildshard/format/lootEconomy';

export type Currency = v.InferOutput<typeof LootEconomySchema.entries.currency.wrapped>;

/** The currency the shard's loot rows declare, admitted by its format schema; null when none names one. */
export function declaredCurrency(rows: readonly { readonly economy?: unknown }[]): Currency | null {
  for (const row of rows) {
    const economy = row.economy;
    if (typeof economy === 'object' && economy !== null && 'currency' in economy) return v.parse(LootEconomySchema.entries.currency.wrapped, economy.currency);
  }
  return null;
}

/** Whether kills pay coins into a purse here. OF31g4 drops the old rule (any loot row) once Driftwood declares its currency. */
export function coinsDeclared(rows: readonly { readonly economy?: unknown }[]): boolean {
  return declaredCurrency(rows) !== null || rows.length > 0;
}
