/**
 * ONE-FORMAT OF31g2 (Q37): a shard's one currency (its coin's name, pickup model and Bag icon) is its `economy/loot`
 * row's `currency` (format 0.67.0), not engine code. Driftwood's declares its own since r9 (OF31g3).
 *
 *   declaredCurrency(source.rows.loot)   // → { id, name, model, icon } or null when no row names one
 *   coinsDeclared(source.rows.loot)      // the purse and kill bursts are on: a declared currency, or any loot row
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

/** Whether kills pay coins into a purse here. The any-loot-row rule stays while live shards pay coins with no currency row:
 *  Brasscap, Ink-Cel, Pastel and Pine, and the SDK's `new` Template (`gear: 'purse.coins'`). OF31g4 found them; it goes once
 *  they declare theirs. */
export function coinsDeclared(rows: readonly { readonly economy?: unknown }[]): boolean {
  return declaredCurrency(rows) !== null || rows.length > 0;
}
