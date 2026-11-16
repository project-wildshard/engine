import named from './slugNames.json' with { type: 'json' };

/** A shard's public `/slug/` name where it differs from its API slug (`slugNames.json`): the link and the address bar read
 *  the public name, the catalogue the API slug. Brasscap Mesa is still the API's old corpus slug (Jake, 2026-11-15: "I
 *  don't know why the fuck this slug is called Blender template"); pages/worker.ts sends the old link to the new one. */
const PUBLIC: Readonly<Record<string, string | undefined>> = named.names;
const API: Readonly<Record<string, string | undefined>> = Object.fromEntries(Object.entries(PUBLIC).map(([api, name]) => [name, api]));

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
