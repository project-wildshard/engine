import type { Shardfile } from '@wildshard/format/shardSchema';

/**
 * The player fields a page reads as this player's owned lines (`wirePage.line`), not as rows: an item's projected field
 * (SR11, C9; the kit publishes it) and, in a shard with scripts, every non-host numeric player field (SHARD-SOURCE SS-GF1a2:
 * the server's `script.player-fields`, a socket this player lit). Any other player field stands at its authored default.
 * The one-shard page and a grid cell read the same set, so a player-field panel shows on both.
 */
export function ownedLineFields(source: Pick<Shardfile, 'targets' | 'state' | 'sim'>): ReadonlySet<string> {
  const scriptLines = source.sim.scripts.length === 0 ? [] : source.state.player.filter(field => field.privacy !== 'host' && field.type !== 'string').map(field => field.name);
  return new Set([...(source.targets.itemFields ?? []).flatMap(row => source.state.player.filter(field => field.id === row.fieldId).map(field => field.name)), ...scriptLines]);
}
