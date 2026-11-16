import retired from './retiredSlugs.json' with { type: 'json' };

/** A slug a shard left behind, and the one it answers to now (`retiredSlugs.json`): its old `/slug/` link opens the new page,
 *  and the address bar reads the new one. Brasscap Mesa was staged as its old corpus name (Jake, 2026-11-15: "I don't know
 *  why the fuck this slug is called Blender template"). */
const RETIRED: Readonly<Record<string, string | undefined>> = retired.slugs;

/** SA36: the slug a `/slug/<slug>` path names (src/client/game/slugPage.ts is its page), or null for any other path. A leaf, so
 *  the entry reads it before anything loads; pages/worker.ts serves the page for the same paths. */
export function slugOfPath(pathname: string): string | null {
  const named = /^\/slug\/([\w-]+)\/?$/u.exec(pathname)?.[1];
  return named === undefined ? null : RETIRED[named] ?? named;
}
