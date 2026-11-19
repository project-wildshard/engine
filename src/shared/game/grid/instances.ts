import { catalogueDocument } from './catalogueDocument';
import { bareSlug } from './catalogueSlot';

/** Select a shard, explore and the grid resolve one durable built-in identity, without a cell suffix. */
export function catalogueInstance(slug: string): string {
  const catalogue = catalogueDocument(), name = bareSlug(slug);
  const placement = catalogue.placements.find(entry => bareSlug(entry.slug) === name)
    ?? catalogue.grid.cells.find(entry => bareSlug(entry.slug) === name);
  if (placement === undefined) throw new RangeError(`Unknown built-in instance: ${slug}`);
  return placement.instance;
}
