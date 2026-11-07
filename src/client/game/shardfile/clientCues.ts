import { parse } from 'valibot';
import { ClientCuesSchema } from '@wildshard/format/clientCues';
import type { ShardContext } from '../plugin/context';
import { CueDirector } from '../audio/cueDirector';
import { clientNativeBook } from './clientNativeBook';

/** Client-only audio/VFX cue presentation; the actual held controller owns
 * action timing and passes its original aim before the contact is resolved. */
export function installClientCues(ctx: ShardContext, input: unknown): void {
  const row = parse(ClientCuesSchema, input), held = clientNativeBook(ctx).held;
  if (row.secondary !== undefined && (held === null || held.row.id !== row.secondary.item || !row.rows.rows.some(cue => cue.id === row.secondary?.cue)))
    throw new Error('Secondary cue requires its actual held owner and cue');
  const book = clientNativeBook(ctx), id = row.id ?? 'main';
  if (book.presentations.has(id)) throw new Error('Duplicate declared cue director');
  const director = CueDirector.install(ctx, row.rows, row.clock), cue = row.secondary?.cue;
  book.presentations.set(id, director);
  if (cue !== undefined && held !== null) {
    const onGust: NonNullable<typeof held.onGust> = (point, direction) => { director.cue(cue, point, direction); };
    held.onGust = onGust;
    ctx.scope.onDispose(() => { if (held.onGust === onGust) held.onGust = null; });
  }
}
