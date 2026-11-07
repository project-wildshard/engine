/** Entered ambient life borrows the original resident flock draws. */
import { parsePageLife } from '@wildshard/format/pageLife';
import type { ShardContext } from '../plugin/context';
import { installPageLife, type PageLife } from '../population/pageLife';
import { entryOwner } from '../../../shared/game/shardfile/entryOwners';

export interface AmbientLifeRows {
  readonly file: string;
  readonly flocks: readonly { readonly id: string; readonly owner: string }[];
}

/** Preflight every concrete draw before reading; the existing page-life host
 * alone owns flock updates, cues and the unchanged system order. No draw is
 * constructed, cloned or disposed by the entry wrapper. */
export async function installClientAmbientLife(ctx: ShardContext, rows: AmbientLifeRows): Promise<PageLife> {
  const live = (): void => { if (ctx.scope.disposed || ctx.scope.disposing) throw new Error('Ambient life entry has ended'); };
  live();
  const ids = new Set(rows.flocks.map(row => row.id));
  if (ids.size !== rows.flocks.length) throw new Error('Duplicate borrowed ambient id');
  const loans = rows.flocks.map(row => ({ ...row, draw: entryOwner(ctx.scope, 'ambient-draw', row.owner) }));
  if (new Set(loans.map(row => row.draw)).size !== loans.length) throw new Error('Duplicate borrowed ambient draw');
  const current = (): void => {
    live();
    for (const row of loans) if (entryOwner(ctx.scope, 'ambient-draw', row.owner) !== row.draw) throw new Error('Ambient draw owner changed during entry');
  };
  const input = await ctx.product.json(rows.file); current();
  const data = parsePageLife(input), borrowed = data.flocks.filter(row => row.borrowed);
  if (borrowed.length !== ids.size || borrowed.some(row => !ids.has(row.id))) throw new Error('Ambient entry requires the exact borrowed flock ids');
  const result = await installPageLife(ctx, data, null, null, new Map(loans.map(row => [row.id, row.draw])));
  current(); return result;
}
