/**
 * Where a page load goes (the composition root's first decision, src/client/app/entry.ts): the renderer-free title, or a level.
 * Pure, so it is tested as a function (test/navigation-arrival.test.ts) rather than by mocking the entry's imports (E422).
 *
 * Safari may reload the same document after WebContent dies: when the previous page ended abruptly while booting the
 * level this URL asks for again, the load is rescued to the title until the player chooses a level again.
 * A URL with only version or environment harness settings is the title too; those settings do not select a level.
 */
export interface BootRoute { readonly rescue: boolean; readonly titleOnly: boolean }
export function bootRoute(search: URLSearchParams, previous: { readonly line: string; readonly level: string; readonly reload?: boolean }): BootRoute {
  if (previous.reload === true) return { rescue: true, titleOnly: true };
  const rescue = previous.line !== '' && search.get('chunk') === previous.level;
  const route = new URLSearchParams(search);
  for (const key of ['v', 'tier', 'touch', 'mute', 'nolock', 'sw']) route.delete(key); // index.html's title-first rule keeps the same list
  return { rescue, titleOnly: rescue || route.size === 0 };
}

/**
 * QA row 16 (Jake, 2026-11-10: "you shouldn't be logged in into the world, into the zone, before you press play"). On a build stamped
 * with a world, a level page seats a body the other players see. So a load that would boot a level (a `?chunk=`, or any other setting
 * that selects the default one) enters only when a tap brought it here (a fresh title arrival or grid intent), or a harness flag that
 * already skips the title asks for it. A reopened tab, a bookmark or a crashed session lands on the title, and nothing joins.
 */
export function onlineTitleFirst(search: URLSearchParams, online: boolean, tapped: boolean): boolean {
  if (!online || tapped || search.has('skipintro') || search.has('tour')) return false;
  return !bootRoute(search, { line: '', level: '' }).titleOnly;
}
