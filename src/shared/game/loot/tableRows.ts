import { parseLootTables } from '@wildshard/format/lootEconomy';
import type { TableSpec } from '@wildshard/engine/ai/weighted';

export interface LootContext { kind: string; variant?: string | undefined; owned?: (id: string) => boolean }
export interface LootTableRow { id: string; domain: 'coins' | 'trophies'; table: TableSpec<string, LootContext> }
/** Compile admitted kind/variant/ownership selectors; WeightedTable still owns draw order and RNG use. */
export function readLootTables(input: unknown): LootTableRow[] {
  return parseLootTables(input).map(({ id, domain, table }) => ({ id, domain, table: { mode: table.mode,
    rows: table.rows.map(({ match, ...row }) => ({ ...row, when: (ctx: LootContext) => ctx.kind === match.kind
      && (match.variant === undefined || ctx.variant === match.variant) && (match.unowned !== true || ctx.owned?.(row.item) !== true) })) } }));
}
