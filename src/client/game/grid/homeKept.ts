/**
 * OF31f2b: the grid page's Owned keeps what its home cell's shard declares. A grid page has no level product (each cell
 * holds its own), so its Owned reads the home cell's `combat/items` kept rows from the cell's own shard file, the way
 * the regional runtime's per-cell Owned reads `request.admitted.source.items`. A cell that declares no kept rows, or whose
 * rows cannot be read, keeps nothing; the save still holds every id (OF31f5).
 */
import { keptItems, type KeptItems, type KeptRow } from '../../../shared/game/loot/Owned';
import { gridShardfileKept } from './folders';

export type KeptReader = (slug: string) => Promise<readonly KeptRow[] | null> | null;

/** The home cell's kept items; none when it declares none or its rows fail to read. */
export async function gridHomeKept(slug: string, read: KeptReader = gridShardfileKept): Promise<KeptItems> {
  try {
    const rows = await read(slug);
    return keptItems(rows === null ? undefined : { kept: rows });
  } catch (error: unknown) {
    console.warn(`[grid] ${slug}'s kept rows were not read; it keeps nothing this visit`, error);
    return keptItems();
  }
}
