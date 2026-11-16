import named from './slugNames.json' with { type: 'json' };

/** A retired `/slug/` name and the slug that replaced it (`slugNames.json`): Brasscap Mesa was the API's old corpus slug
 *  blender-template (Jake, 2026-11-15: "I don't know why the fuck this slug is called Blender template"); since TC-SHIP-a
 *  the catalogue names it brasscap-mesa. pages/worker.ts sends the old link to the new one; the page reads it as the new. */
const PUBLIC: Readonly<Record<string, string | undefined>> = named.names;
const API = PUBLIC;

/** SA36: the API slug a `/slug/<name>` path names (src/client/game/slugPage.ts is its page), or null for any other path. A
 *  leaf, so the entry reads it before anything loads; pages/worker.ts serves the page for the same paths. */
export function slugOfPath(pathname: string): string | null {
  const name = /^\/slug\/([\w-]+)\/?$/u.exec(pathname)?.[1];
  return name === undefined ? null : API[name] ?? name;
}

/** The `/slug/` path a shard's link reads: its public name, else its API slug. */
export function slugPathOf(slug: string): string {
  return `/slug/${PUBLIC[slug] ?? slug}`;
}
