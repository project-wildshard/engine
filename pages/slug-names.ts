// TEMPLATE-E2E TC-B12: a shard's public `/slug/` name where it differs from its API slug. The page reads the same map
// (src/client/app/slugNames.json; test/page-workers.test.ts holds the two equal). Brasscap Mesa is still the API's old
// corpus slug (Jake, 2026-11-15: "I don't know why the fuck this slug is called Blender template").
const NAMES: readonly (readonly [string, string])[] = [['blender-template', 'brasscap-mesa']]
const SLUG_NAMES: Readonly<Record<string, string | undefined>> = Object.fromEntries(NAMES)

/** The API slug a public name stands for, else the name itself. */
function apiSlugOf(name: string): string {
  for (const [api, publicName] of NAMES) {
    if (publicName === name) {
      return api
    }
  }
  return name
}

/** A shard's public name, else its API slug. */
function publicNameOf(slug: string): string {
  return SLUG_NAMES[slug] ?? slug
}

export { apiSlugOf, publicNameOf, SLUG_NAMES }
