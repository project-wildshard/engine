/**
 * Where a page load goes (the composition root's first decision, src/client/app/entry.ts): the renderer-free title, or a level.
 * Pure, so it is tested as a function (test/navigation-arrival.test.ts) rather than by mocking the entry's imports (E422).
 *
 * Safari may reload the same document after WebContent dies: when the previous page ended abruptly while booting the
 * level this URL asks for again, the load is rescued to the title until the player chooses a level again.
 * A URL with only version or environment harness settings is the title too; those settings do not select a level.
 */
/** Explore's standalone entry opens a shard into its hub unless a view was requested; its zone is its path's (entry.ts). */
export function exploreBootParams(search: URLSearchParams): URLSearchParams {
  const route = new URLSearchParams(search);
  if (!route.has('explore')) route.set('explore', 'hub');
  return route;
}

export interface BootRoute { readonly rescue: boolean; readonly titleOnly: boolean }
/** CHUNK-PARAM CP22 (J522): a load boots a world only for a zone it was handed (a tap, the tab's handoff, a recovery record, Explore's
 *  path or an inline world); an address never picks a level, so with no zone the load is the title. */
export function bootRoute(zone: string | null, previous: { readonly line: string; readonly level: string; readonly reload?: boolean }): BootRoute {
  if (previous.reload === true) return { rescue: true, titleOnly: true };
  const rescue = previous.line !== '' && zone !== null && [previous.level].includes(zone);
  return { rescue, titleOnly: rescue || zone === null };
}

/**
 * QA row 16 (Jake, 2026-11-10: "you shouldn't be logged in into the world, into the zone, before you press play"). On a build stamped
 * with a world, a level page seats a body the other players see. So a load handed a zone enters only when a tap brought it here (a
 * fresh title arrival or grid intent), or a harness flag that already skips the title asks for it. A reopened tab, a bookmark or a crashed session lands on the title, and nothing joins.
 */
export function onlineTitleFirst(search: URLSearchParams, zone: string | null, online: boolean, tapped: boolean): boolean {
  // ?glreload is the engine's own reload back into the world (GPU recovery, RELOAD HERE, the reload prompt; play.ts strips it once
  // read, so a reopened tab has none): QA-FEEDBACK-2026-11-13 rows 6 and 13 (WILDSHARD-GAME-8H), a GPU process restart on an
  // Android phone sent the player to the title instead
  if (!online || tapped || search.has('skipintro') || search.has('tour') || search.has('glreload')) return false;
  return !bootRoute(zone, { line: '', level: '' }).titleOnly;
}
