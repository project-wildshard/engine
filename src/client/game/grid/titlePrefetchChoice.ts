import * as v from 'valibot';
import type {SaveStore} from '@wildshard/engine/saves/store';
import type {TitleManifest} from '../shard/titleList';
import {playerHidden} from '../../../shared/game/grid/catalogueSlot';

/** A scheduling preference only; it cannot select a world or admit a file. */
export interface TitlePrefetchChoice {
  readonly read: () => string | null;
  readonly flow: () => 'client' | 'grid';
  readonly remember: (slug: string, flow?: 'client' | 'grid') => void;
}
const choices = new WeakMap<Pick<SaveStore, 'define'>, TitlePrefetchChoice>();
/** Define lazily at the composition root; importing this module installs no
 * save, listener, downloader or service. Blocked storage keeps its fallback. */
export function titlePrefetchChoice(store: Pick<SaveStore, 'define'>): TitlePrefetchChoice {
  const previous = choices.get(store);
  if (previous !== undefined) return previous;
  const slug = v.pipe(v.string(), v.maxLength(120), v.regex(/^[a-z0-9_-]+$/u));
  const schema = v.nullable(v.looseObject({slug, flow: v.picklist(['client', 'grid'])}));
  const slot = store.define({key: 'titlePrefetch', scope: 'device', version: 2, schema, initial: () => null,
    migrate: {1: (old: unknown) => typeof old === 'string' ? {slug: old, flow: 'client'} : null}});
  const choice: TitlePrefetchChoice = {read: () => slot.read()?.slug ?? null, flow: () => slot.read()?.flow ?? 'client',
    remember: (selected, flow = 'client'): void => {slot.write({slug: selected, flow});}};
  choices.set(store, choice);
  return choice;
}

/** G897, S2: the title reads ahead only for the player's real last pick, in that pick's flow, and for nothing on a first
 * visit: a guess spends bytes on a shard the player may never choose. Entering a shard still pre-downloads all of it.
 * Frozen LEGACY-only, hidden and unavailable metadata never seeds downloads. */
export function titlePrefetchTarget(last: string | null, rows: readonly TitleManifest[], developer: boolean): string | undefined {
  const row = last === null ? undefined : new Map(rows.map(candidate => [candidate.slug, candidate])).get(last);
  if (row === undefined || row.shardfile === undefined && row.gridShardfile === undefined) return undefined;
  return developer || !playerHidden(row) ? row.slug : undefined; // J313: experimental and partial shards are player picks
}
