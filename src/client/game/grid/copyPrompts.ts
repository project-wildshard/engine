/**
 * A template copy's "[E] …" prompts inside the grid (SHARD-PLATFORM template-prompts, E435). Standalone, a shardfile
 * shard's declared interactions (`targets.interactions`: the template's hut door) become the page runtime's prompts
 * (`installDeclaredTargets`). In the grid every copy is a region of the server's, so the same rows become that region's
 * prompts here: in its frame (the source's own coordinates are frame-local), and each press goes to the server by its row,
 * which runs the scene. The page offers them only while the feet stand in the entered copy (`enteredCopy`), and they go
 * with the region (built at admission, dropped at its disposal).
 *
 * An item scene's prompt (`targets.itemActions`: Brasscap's rack) is offered too (TEMPLATE-E2E TC-E1b): an entered copy holds
 * its declared kit (`dataCellKit.ts`), and the server runs the scene on the held item, as it does a standalone page's.
 */
import { Vector3 } from 'three';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { takenLine } from '../../../shared/game/shardfile/items';
import { spentUses } from '../shard/declaredTargets';
import { wirePage } from '../shardfile/wirePage';

type Interactable = ShardRuntime['interactables'][number];

/** The copy's declared interactions as frame-local prompts the server answers. A `spent` use (TE-ENG6, `spentUses`: a taken
 *  rack, a lit brazier) keeps its place with no reach while it is spent (TEMPLATE-E2E TC-E4c). */
export function copyPrompts(source: Pick<Shardfile, 'targets'>, spent?: (row: Shardfile['targets']['interactions'][number]) => boolean): Interactable[] {
  return source.targets.interactions.map((row) => ({
    position: new Vector3(...row.at), get radius() { return spent?.(row) === true ? 0 : row.radius; }, label: row.label, wireId: row.id, onInteract: () => undefined,
  }));
}

/** A copy's spent uses off the wire's rows: its fields as the server sends them, a rack taken when its owned line says so.
 *  The page offers a copy's prompts only while the feet stand in it, so the wire's lines are that copy's. */
export function copySpent(source: Pick<Shardfile, 'targets' | 'hooks' | 'items' | 'state'>): (row: Shardfile['targets']['interactions'][number]) => boolean {
  return spentUses(source, {
    read: (scope, id) => {
      const field = source.state[scope].find(row => row.id === id); if (field === undefined) throw new Error('Missing declared state field');
      // a public shared field has rows; a player's own stands at its authored default, as on a one-shard page (RETIRE-FEED A6)
      const value = scope === 'shared' && field.privacy === 'public' ? wirePage.row(field.name) : undefined;
      return value ?? (typeof field.default === 'number' ? field.default : Number(field.default === true));
    },
    taken: item => wirePage.line(takenLine(item)) > 0,
  });
}

/** The template copy whose prompts the page may use now: the live frame the traveller stands in, when the feet stand in
 *  that same cell (never on the road, nor mid-crossing with the feet across the seam), and it is an admitted copy. */
export function enteredCopy(state: Readonly<{ current: string | null; feetCell: string | null | undefined }>, admitted: (instance: string) => boolean): string | null {
  const { current, feetCell } = state;
  return current !== null && feetCell === current && admitted(current) ? current : null;
}
