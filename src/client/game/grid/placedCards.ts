// SHARD-AUTHORING SA46 (meta SHARD-AUTHORING-PLAN): the card of a shard the API placed after this page was built. The placement file
// (`placedCells.ts`) names its cell, but the build bakes no title row for it: a new author's slug uploaded since. Its row comes from
// the API's catalogue entry (`GET /api/catalogue/shards/<slug>`, which answers the three game origins with CORS), carded plainly by
// name (`catalogueTitleRow`): the API hosts no uploaded shard's images. Any failure (offline, a 404, no CORS, junk, a name that is
// not a name) gives no row, and the cell stays out as before.
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { apiOrigin } from '@wildshard/engine/core/apiOrigin';
import { catalogueTitleRow, type TitleManifest } from '../shard/titleList';

/** At most this many entries are asked for in one boot: a file rarely adds more than one new slug at a time. */
export const CARD_LOOKUPS = 4;
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
    return entry.success && new Set([slug]).has(entry.output.slug) ? catalogueTitleRow(slug, entry.output.name, order) : undefined;
  } catch { return undefined; }
}

/** The plain title rows of `slugs` the API's catalogue names, in their order; slugs it does not know are left out. */
export async function catalogueCards(slugs: readonly string[], ports: CardPorts): Promise<readonly TitleManifest[]> {
  const asked = [...new Set(slugs)].slice(0, CARD_LOOKUPS);
  const scope = new Scope('grid.placed-cards'), abort = new AbortController(), stop = (): void => { abort.abort(); };
  try {
    scope.timeout(ports.deadlineMs ?? CARD_DEADLINE_MS, stop);
    if (ports.signal.aborted) stop(); else scope.listen(ports.signal, 'abort', stop);
    const own = { ...ports, signal: abort.signal };
    const rows = await Promise.all(asked.map((slug, n) => catalogueCard(slug, ports.order + n, own)));
    return rows.filter(row => row !== undefined);
  } finally { scope.dispose(); }
}
