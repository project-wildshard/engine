/**
 * A template copy's "[E] …" prompts inside the grid (SHARD-PLATFORM template-prompts, E435). Standalone, a shardfile
 * shard's declared interactions (`targets.interactions`: the template's hut door) become the page runtime's prompts
 * (`installDeclaredTargets`). In the grid every copy is a region of the server's, so the same rows become that region's
 * prompts here: in its frame (the source's own coordinates are frame-local), and each press goes to the server by its row,
 * which runs the scene. The page offers them only while the feet stand in the entered copy (`enteredCopy`), and they go
 * with the region (built at admission, dropped at its disposal).
 *
 * Not here: an item scene (`targets.itemActions`, the template's lantern toggle / refill) is the held item's own action;
 * a template cell holds its empty equipment (bare hands, G68), so no prompt can reach an item runtime there.
 */
import { Vector3 } from 'three';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import type { Shardfile } from '@wildshard/format/shardSchema';

type Interactable = ShardRuntime['interactables'][number];

/** The copy's declared interactions as frame-local prompts the server answers. */
export function copyPrompts(source: Pick<Shardfile, 'targets'>): Interactable[] {
  const items = new Set((source.targets.itemActions ?? []).map((row) => row.scene));
  return source.targets.interactions.filter((row) => !items.has(row.scene)).map((row) => ({
    position: new Vector3(...row.at), radius: row.radius, label: row.label, wireId: row.id, onInteract: () => undefined,
  }));
}

/** The template copy whose prompts the page may use now: the live frame the traveller stands in, when the feet stand in
 *  that same cell (never on the road, nor mid-crossing with the feet across the seam), and it is an admitted copy. */
export function enteredCopy(state: Readonly<{ current: string | null; feetCell: string | null | undefined }>, admitted: (instance: string) => boolean): string | null {
  const { current, feetCell } = state;
  return current !== null && feetCell === current && admitted(current) ? current : null;
}
