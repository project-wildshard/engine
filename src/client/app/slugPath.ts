import { retiredSlugs as retired, SLUG_NAMES } from '@wildshard/engine/game/slugNames';

/** A retired `/slug/` name and the slug that replaced it (the placement file's `aliases`, OF31i4): Brasscap Mesa was the API's old corpus slug
 *  blender-template (Jake, 2026-11-15: "I don't know why the fuck this slug is called Blender template"); since TC-SHIP-a
 *  the catalogue names it brasscap-mesa. pages/worker.ts sends the old link to the new one; the page reads it as the new. */
const PUBLIC = SLUG_NAMES;
const API = PUBLIC;

/** SA36: the API slug a `/slug/<name>` path names (src/client/game/slugPage.ts is its page), or null for any other path. A
 *  leaf, so the entry reads it before anything loads; pages/worker.ts serves the page for the same paths. */
export function slugOfPath(pathname: string): string | null {
  const name = /^\/slug\/([\w-]+)\/?$/u.exec(pathname)?.[1];
  return name === undefined ? null : API[name] ?? name;
}

/** The standalone Explore app uses a single public path segment. */
export function exploreSlugOfPath(pathname: string): string | null {
  const name = /^\/([a-z0-9-]{1,80})\/?$/u.exec(pathname)?.[1];
  return name === undefined ? null : currentSlug(name);
}

/** Each retired slug and the slug that replaced it, for the save namespaces a rename carries (TC-SHIP-a). */
export function retiredSlugs(): readonly (readonly [string, string])[] { return retired(); }

/** The slug an Explore path names today: a retired slug's replacement, else the slug itself (TC-SHIP-a). A slug the build's
 *  catalogue still `listed` stays itself: Ring 1's blender-template is the format's own Template 2, not Brasscap Mesa. */
export function currentSlug(slug: string, listed: (slug: string) => boolean = () => false): string {
  return listed(slug) ? slug : API[slug] ?? slug;
}

/** The `/slug/` path a shard's link reads: its public name, else its API slug. */
export function slugPathOf(slug: string): string {
  return `/slug/${PUBLIC[slug] ?? slug}`;
}
