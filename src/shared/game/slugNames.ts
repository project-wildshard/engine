/** A retired shard slug and the slug that replaced it. World data, not engine data (ONE-FORMAT OF31i4): the API signs the
 *  map into every channel's placement file (`aliases`, OF31i2), and the box (server/host/dedicated/placementFile.ts) and
 *  the page (client/game/grid/placedCells.ts) lay it in here. The page reads it for links and saves (client/app/slugPath.ts),
 *  the profile ledger for achievements and entitlements (ledger.ts, TC-SHIP-g); the page's Worker reads the same file
 *  (pages/placed-slug.ts). A build with no placement file has none. */
const names: Record<string, string | undefined> = {};
export const SLUG_NAMES: Readonly<Record<string, string | undefined>> = names;

/** OF31i: a believed placement file's aliases are laid in, never removed. */
export function adoptSlugAliases(aliases: Readonly<Record<string, string>> | undefined): void {
  if (aliases === undefined) return;
  for (const [old, now] of Object.entries(aliases)) if (old !== now) names[old] = now;
}

/** Each retired slug and the slug that replaced it. */
export function retiredSlugs(): readonly (readonly [string, string])[] {
  return Object.entries(SLUG_NAMES).flatMap(([old, now]) => now === undefined ? [] : [[old, now] as const]);
}
