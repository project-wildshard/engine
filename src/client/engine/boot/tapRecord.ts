// CHUNK-PARAM-REMOVAL CP12 (meta plan, J522): the bytes of a Zone Select tap, with no imports, so the title
// (titleArrival.ts `setTitleArrival`) and the harness (`scripts/zone-entry.mjs` `enterZone`) write the same record and
// can't drift. A tool enters a zone the way a player does: this record in the tab, then a bare `/`.

/** The modes a tap carries (titleArrival.ts `TitleArrivalMode`). */
export type TapMode = 'enter' | 'explore' | 'arena';
/** What a tap names: its zone (`slug`), how it enters, and the first card's display facts. */
export interface TapFacts { readonly slug: string; readonly mode: TapMode; readonly name?: string; readonly tier?: string; readonly art?: string }
/** The session-scope save key the tap lives under (saves/slots.ts `titleArrival`). */
export const TAP_KEY = 'titleArrival';

/** The record's JSON: the tap's facts, its time (`at`, ms since the epoch) and the writer's extras (its document, boot timing). */
export function tapRecord(tap: TapFacts, at: number, extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ ...tap, at, ...extra });
}

/** The session store's document (`<savePrefix>session`, `{ keys: { name: { v, data } } }`) with `raw` as the tap, keeping
 *  every other key it held; `held` is the document's current text, or null. The store keeps `data` as the parsed record, as
 *  saveStorage writes it: a string there reads back as a string, which the entry refuses and the page shows the title. */
export function tapSessionDocument(held: string | null, raw: string): string {
  let doc: { keys: Record<string, unknown> } = { keys: {} };
  try {
    const parsed: unknown = held === null ? null : JSON.parse(held);
    if (typeof parsed === 'object' && parsed !== null && 'keys' in parsed && typeof parsed.keys === 'object' && parsed.keys !== null) {
      doc = { ...parsed, keys: { ...(parsed.keys as Record<string, unknown>) } };
    }
  } catch { /* an unreadable document is replaced */ }
  doc.keys[TAP_KEY] = { v: 1, data: JSON.parse(raw) as unknown };
  return JSON.stringify(doc);
}
