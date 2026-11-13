/** SA36: the slug a `/slug/<slug>` path names (src/client/game/slugPage.ts is its page), or null for any other path. A leaf, so
 *  the entry reads it before anything loads; pages/worker.ts serves the page for the same paths. */
export function slugOfPath(pathname: string): string | null {
  return /^\/slug\/([\w-]+)\/?$/u.exec(pathname)?.[1] ?? null;
}
