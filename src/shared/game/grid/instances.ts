import { catalogueDocument } from './catalogueDocument';

/** Select a shard, explore and the grid resolve one durable built-in identity, without a cell suffix. */
export function catalogueInstance(slug: string): string {
  const normalize = (name: string): string => name.replace(/^_/u, '');
  const placement = catalogueDocument().placements.find((entry) => normalize(entry.slug) === normalize(slug));
  if (placement === undefined) throw new RangeError(`Unknown built-in instance: ${slug}`);
  return placement.instance;
}
