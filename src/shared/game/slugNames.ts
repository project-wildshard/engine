import named from './slugNames.json' with { type: 'json' };

/** A retired shard slug and the slug that replaced it (`slugNames.json`). Brasscap Mesa was the API's old corpus slug
 *  blender-template (Jake, 2026-11-15: "I don't know why the fuck this slug is called Blender template"); since TC-SHIP-a
 *  the catalogue names it brasscap-mesa. The page reads it for links and saves (client/app/slugPath.ts), the profile ledger
 *  for achievements and entitlements (ledger.ts, TC-SHIP-g); pages/slug-names.ts keeps the same map for the page's Worker. */
const names: Record<string, string | undefined> = { ...named.names };
export const SLUG_NAMES: Readonly<Record<string, string | undefined>> = names;

/** OF31i: the placement file's aliases (world data) beat the built map; a believed file's are laid over it, never removed. */
export function adoptSlugAliases(aliases: Readonly<Record<string, string>> | undefined): void {
  if (aliases === undefined) return;
  for (const [old, now] of Object.entries(aliases)) if (old !== now) names[old] = now;
}

/** Each retired slug and the slug that replaced it. */
export function retiredSlugs(): readonly (readonly [string, string])[] {
  return Object.entries(SLUG_NAMES).flatMap(([old, now]) => now === undefined ? [] : [[old, now] as const]);
}
