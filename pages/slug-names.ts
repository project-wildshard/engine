// TEMPLATE-E2E TC-B12, TC-SHIP-a: a retired `/slug/` name and the slug that replaced it. The page reads the same map
// (src/shared/game/slugNames.json; test/page-workers.test.ts holds the two equal). Brasscap Mesa was the API's old corpus
// slug blender-template (Jake, 2026-11-15: "I don't know why the fuck this slug is called Blender template"); since
// TC-SHIP-a the catalogue names it brasscap-mesa, and the old link still finds it.
const NAMES: readonly (readonly [string, string])[] = [['blender-template', 'brasscap-mesa']]
const SLUG_NAMES: Readonly<Record<string, string | undefined>> = Object.fromEntries(NAMES)

/** The API slug a name stands for: a retired name's replacement, else the name itself. */
function apiSlugOf(name: string): string {
  return SLUG_NAMES[name] ?? name
}

/** A shard's public name: a retired name's replacement, else the slug itself. */
function publicNameOf(slug: string): string {
  return SLUG_NAMES[slug] ?? slug
}

export { apiSlugOf, publicNameOf, SLUG_NAMES }
