/** J450 (QA-FEEDBACK 2026-11-19 row 15): where the cook's top-down map of a shard is served, beside its header under the shard's
 *  own folder (`/shardfiles/<slug>/…`), so a placed slug's copy is its upload's loose file (`placedLoose`). The cook writes it
 *  (`src/cook/game/cookedMap.ts`) and the page reads it (`grid/session.ts`). A new look is a new version: the name carries it, so
 *  a store's immutable copy of an older look is never read as the new one. */
export const COOKED_MAP_VERSION = 1;
/** `full`: 1024 px, the home cell's minimap. `cell`: 400 px, every other cell (the Bag map, a neighbour on the minimap). */
export type CookedMapSize = 'full' | 'cell';
/** Below this luminance spread (0-255) over a 32 px copy, an author's `look/map` reads as one flat colour on the Bag map and counts
 *  as no map: the cook's is drawn (Saltwind's measured 1.0, Cinder Orchard's 1.5; Ink-Cel's faint plan 2.9; every baked map 5+). */
export const FLAT_MAP_SPREAD = 2.5;
export const cookedMapPath =(slug: string, size: CookedMapSize = 'full'): string =>
  `shardfiles/${slug.replace(/^_/u, '')}/cooked-map-v${COOKED_MAP_VERSION}${size === 'cell' ? '-cell' : ''}.png`;
