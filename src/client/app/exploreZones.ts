import { apiOrigin } from '@wildshard/engine/core/apiOrigin';
import { bareSlug, type CatalogueDocument } from '@wildshard/engine/game/grid/catalogueSlot';
import type { TitleManifest } from '@wildshard/engine/game/shard/titleList';

/** J461's Featured order, used when the installed build can't reach Zone Select. */
const FEATURED = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'mossgate', 'brasscap-mesa', 'sunscar-dunes', 'far-reach'];

export interface ExploreZone {
  readonly slug: string;
  readonly name: string;
  readonly image?: string;
}

interface ZoneSelectCard {
  readonly slug: string;
  readonly name: string;
}

/** J461's public staging list. Explore uses the card identity; art stays with the baked product. */
export async function readExploreOrder(read: typeof fetch = fetch, origin: string = apiOrigin()): Promise<readonly ZoneSelectCard[] | null> {
  try {
    const response = await read(`${origin}/api/zone-select?channel=staging`, {
      credentials: 'omit', signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || !('channel' in value) || value.channel !== 'staging') return null;
    const cards: ZoneSelectCard[] = [];
    for (const tab of ['featured', 'popular', 'new']) {
      const list: unknown = Reflect.get(value, tab);
      if (!Array.isArray(list)) return null;
      for (const row of list as unknown[]) {
        if (typeof row !== 'object' || row === null || !('slug' in row) || typeof row.slug !== 'string' ||
          !/^[a-z0-9-]{1,80}$/u.test(row.slug) || !('name' in row) || typeof row.name !== 'string' || row.name.trim() === '') return null;
        cards.push({ slug: row.slug, name: row.name });
      }
    }
    return cards;
  } catch {
    return null;
  }
}

/** Every installed, visible placement. Entering one reads the same product the boot catalogue names. */
export function exploreZones(catalogue: CatalogueDocument | undefined, titles: readonly TitleManifest[],
  served: readonly ZoneSelectCard[] | null = null): readonly ExploreZone[] {
  const placements = catalogue?.placements ?? [], cells = catalogue?.grid.cells ?? [];
  const placed = new Set([...placements, ...cells].map(row => row.slug).filter(slug => !slug.startsWith('_')));
  const status = new Map(placements.map(row => [bareSlug(row.slug), row.status]));
  const available = new Map<string, ExploreZone>();
  for (const row of titles) {
    const slug = row.slug;
    if (!placed.has(slug) || /^open-plot(?:-|$)/u.test(slug) || (status.get(slug) ?? row.status) === 'hidden') continue;
    available.set(slug, { slug, name: row.name, image: row.card.landscape });
  }
  for (const row of catalogue?.shards ?? []) {
    if (available.has(row.slug) || !placed.has(row.slug) || /^open-plot(?:-|$)/u.test(row.slug) || status.get(row.slug) === 'hidden') continue;
    available.set(row.slug, { slug: row.slug, name: row.name });
  }
  const ordered = new Map<string, ExploreZone>();
  for (const slug of FEATURED) {
    const row = available.get(slug);
    if (row !== undefined) ordered.set(slug, row);
  }
  if (served !== null) {
    ordered.clear();
    for (const card of served) {
      const row = available.get(card.slug);
      if (row !== undefined && !ordered.has(card.slug)) ordered.set(card.slug, { ...row, name: card.name });
    }
  }
  for (const [slug, row] of available) if (!ordered.has(slug)) ordered.set(slug, row);
  return [...ordered.values()];
}
