import * as v from 'valibot';
import { WeightedTable, type TableDrop } from '@wildshard/engine/ai/weighted';
import type { SimHost } from '@wildshard/engine/sim';
import { bountyKey } from '../../../shared/game/loot/Bounty';
import { coinValue } from '../../../shared/game/loot/coinAmounts';
import { readLootTables, type LootContext } from '../../../shared/game/loot/tableRows';

/** What a personal roll needs of the shard. */
export interface PersonalLootPorts {
  /** A body's coins for one player's roll, off `next`: the page's table. Absent on a shard whose kills pay none. */
  readonly coins: ((kind: string, next: () => number) => number) | null;
  /** File the grant in the tick's ledger effects, for this player alone. */
  readonly grant: (player: string, coins: number) => void;
  /** A body's items for one player's roll, off `next`; `owned` is what they have already been paid. Absent on a shard with no item table. */
  readonly items?: ((context: LootContext, next: () => number) => readonly TableDrop<string>[]) | undefined;
  /** File an item grant the same way. */
  readonly grantItem?: ((player: string, item: string, count: number) => void) | undefined;
  /** A room pays a lone player too: nothing else will once the page's feed goes. Off a room, the page pays one player. */
  readonly alone?: boolean | undefined;
}
const Economy: v.GenericSchema<unknown, { rows: { loot: { economy?: { tables?: unknown } | undefined }[] } }> = v.object({ rows: v.object({ loot: v.array(v.object({ economy: v.optional(v.object({ tables: v.optional(v.unknown()) })) })) }) });
/** A shard's coin roll, from its `economy/loot` rows: the table the page pays from. Null on a shard whose kills pay nothing. */
export function personalCoinTable(economy: unknown): NonNullable<PersonalLootPorts['coins']> | null {
  if (economy === undefined) return null;
  const tables = v.parse(Economy, economy).rows.loot[0]?.economy?.tables;
  const row = tables === undefined ? undefined : readLootTables(tables).find(entry => entry.domain === 'coins' || entry.id === 'coins');
  if (row === undefined) return null;
  const table = new WeightedTable<string, LootContext>(row.table);
  return (kind, next) => coinValue(table.roll({ kind }, next));
}
/** A shard's item rolls, from every `trophies` table in its `economy/loot` rows. Null on a shard with none. */
export function personalItemTable(economy: unknown): NonNullable<PersonalLootPorts['items']> | null {
  if (economy === undefined) return null;
  const tables = v.parse(Economy, economy).rows.loot[0]?.economy?.tables;
  const rows = tables === undefined ? [] : readLootTables(tables).filter(entry => entry.domain === 'trophies').map(entry => new WeightedTable<string, LootContext>(entry.table));
  return rows.length === 0 ? null : (context, next) => rows.flatMap(table => table.roll(context, next));
}
const paidKey = (player: string, key: string): string => `loot:${player}:${key}`;
const itemKey = (player: string, item: string): string => `loot:${player}:item:${item}`;

/**
 * J105, M8: personal loot on the server. When a body dies in a room, everyone with meaningful damage (`DamageBook.meaningful`)
 * rolls for themselves, off the `loot` stream, and the grant goes through the tick's ledger effects and an event only they get.
 * Items roll the same way: what a player has been paid is theirs, so a once-only trophy falls for each of them once.
 * Each player's bounty is its own: a slot pays them as many times as the shard started with it, counted in
 * `slots.ledgerDedupe`, so a replayed death grants nothing twice.
 *
 * Off a room, a lone player's drops stay exactly what the page pays today, and a one-player save keeps its bytes.
 */
export function installPersonalLoot(host: SimHost, ports: PersonalLootPorts): void {
  const caps = new Map<string, number>();
  for (const body of host.entities.values()) { const key = bountyKey(body); caps.set(key, (caps.get(key) ?? 0) + 1); }
  const next = (): number => host.rng.stream('loot').next(), { ledgerDedupe } = host.slots;
  host.events.on('actor.died', ({ actor }) => {
    const body = host.entities.get(actor.id), rollers = host.damage.meaningful(actor.id);
    host.damage.forget(actor.id);
    if (body === undefined || (host.players.size < 2 && ports.alone !== true)) return;
    const key = bountyKey(body), cap = caps.get(key) ?? 1;
    for (const player of rollers) {
      const paid = paidKey(player, key);
      if (ledgerDedupe.filter(row => row === paid).length >= cap) continue;
      const coins = ports.coins?.(body.kind, next) ?? 0;
      const items = ports.items?.({ kind: body.kind, variant: body.variant, owned: item => ledgerDedupe.includes(itemKey(player, item)) }, next) ?? [];
      if (coins <= 0 && items.length === 0) continue;
      ledgerDedupe.push(paid);
      if (coins > 0) { ports.grant(player, coins); host.events.emit('reward.granted', { player, coins, body: actor.id }); }
      for (const { item, count } of items) { ledgerDedupe.push(itemKey(player, item)); ports.grantItem?.(player, item, count); }
    }
  }, host.scope);
}
