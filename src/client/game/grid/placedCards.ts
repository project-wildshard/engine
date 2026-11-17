// SHARD-AUTHORING SA46 (meta SHARD-AUTHORING-PLAN): the card of a shard the API placed after this page was built. The placement file
// (`placedCells.ts`) names its cell, but the build bakes no title row for it: a new author's slug uploaded since. Its row comes from
// the API's catalogue entry (`GET /api/catalogue/shards/<slug>`, which answers the three game origins with CORS), carded plainly by
// name (`catalogueTitleRow`): the API hosts no uploaded shard's images. Any failure (offline, a 404, no CORS, junk, a name that is
// not a name) gives no row, and the cell stays out as before.
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { apiOrigin } from '@wildshard/engine/core/apiOrigin';
import { catalogueTitleRow, type TitleManifest } from '../shard/titleList';

/** At most this many entries are asked for at once (a browser's six connections to one HTTP/1.1 origin). Every placed slug the build
 *  lacks is asked for (SHARD-SOURCE SS-JP2: staging placed six uploads after v0.1.34's build, and a four-lookup cap left Glowfen with
 *  no card), in turns of this many, all inside `CARD_DEADLINE_MS`. One entry is ~0.7 KB and ~0.1 to 0.3 s from staging's API. */
export const CARD_PARALLEL = 6;
/** The lookups' own deadline, inside the placement file's 3 s: a slow API never costs the cells the build already cards. */
export const CARD_DEADLINE_MS = 1500;
const NAME_CHARS = 80;
/** An entry is about 1.5 KB; anything past this is not one. */
const ENTRY_BYTES = 64 * 1024;
const EntrySchema = v.looseObject({ slug: v.string(), name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(NAME_CHARS)) });

export interface CardPorts {
  readonly fetch: typeof fetch;
  /** The API's origin (`VITE_API_ORIGIN`, '' for the page's own). */
  readonly api?: string;
  readonly signal: AbortSignal;
  /** The first new row's `order`: after the build's rows. */
  readonly order: number;
  readonly deadlineMs?: number;
}

// the name is the slug itself, byte for byte: a one-word name that is its slug capitalised is a real name (SHARD-SOURCE SS14e)
const unnamed = (slug: string, name: string): boolean => new Set([slug]).has(name.trim());
/** `mu9-auto-20261116` → `Mu9 Auto 20261116` */
const slugName = (slug: string): string => slug.split(/[-_]+/u).filter(word => word !== '').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

/** One slug's catalogue row, or undefined for anything but an entry that names this slug. Never throws. */
async function catalogueCard(slug: string, order: number, ports: CardPorts): Promise<TitleManifest | undefined> {
  try {
    const url = `${ports.api ?? apiOrigin()}/api/catalogue/shards/${encodeURIComponent(slug)}`;
    // called bare: a browser's `fetch` called as a method of another object throws Illegal invocation
    const read = ports.fetch, response = await read(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: ports.signal });
    if (!response.ok) { await response.body?.cancel(); return undefined; }
    const text = await response.text();
    if (text.length > ENTRY_BYTES) return undefined;
    const entry = v.safeParse(EntrySchema, JSON.parse(text));
    if (!entry.success || !new Set([slug]).has(entry.output.slug)) return undefined;
    // STAGING-BUGBASH SB12: an upload named only by its slug (staging's `mu9-auto-20261116`, an auto-placement test) is a test
    // placement: a Developer sees it under a readable name, a player not at all
    return unnamed(slug, entry.output.name) ? { ...catalogueTitleRow(slug, slugName(slug), order), status: 'hidden' } : catalogueTitleRow(slug, entry.output.name, order);
  } catch { return undefined; }
}

/** The plain title rows of `slugs` the API's catalogue names, in their order; slugs it does not know are left out. */
export async function catalogueCards(slugs: readonly string[], ports: CardPorts): Promise<readonly TitleManifest[]> {
  const asked = [...new Set(slugs)];
  const scope = new Scope('grid.placed-cards'), abort = new AbortController(), stop = (): void => { abort.abort(); };
  try {
    scope.timeout(ports.deadlineMs ?? CARD_DEADLINE_MS, stop);
    if (ports.signal.aborted) stop(); else scope.listen(ports.signal, 'abort', stop);
    const own = { ...ports, signal: abort.signal };
    const rows: (TitleManifest | undefined)[] = asked.map(() => undefined);
    let next = 0;
    // CARD_PARALLEL workers take the next slug in turn; none starts a lookup once the deadline or the page has given up
    const worker = async (): Promise<void> => {
      for (let n = next++; n < asked.length && !abort.signal.aborted; n = next++) rows[n] = await catalogueCard(asked[n] ?? '', ports.order + n, own);
    };
    await Promise.all(Array.from({ length: Math.min(CARD_PARALLEL, asked.length) }, worker));
    return rows.filter(row => row !== undefined);
  } finally { scope.dispose(); }
}
