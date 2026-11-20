import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/**
 * Whether a regional runtime's kit plays on the server's wire (ONE-FORMAT OF19d). A cell with a native runtime plan has its
 * held weapon run by the server (`installNativeMelee`), and its crack rows wait on that weapon's own lash: off the wire the
 * page's whip cracked the Dunes crank by itself, the page said the bucket was up, and the server, which never heard the
 * crack, refused the well's oil without a word. Such a kit takes the road's wire, as a data cell's does (TC-E1b); a cell
 * whose server holds no weapon keeps its kit's own contacts.
 *
 * A native-assembly cell (Driftwood, Pine Hollow, Nalati: the server's `nativeCell`) runs its held weapon too. Its assembly
 * file is server-only, so the page knows it by the shardfile's bound `runtime`. Off the wire the Driftwood sword swung on the
 * page alone and no crab, sailor or captain ever took a hit on the grid (meta QA-FEEDBACK-2026-11-20-mini, mini-dw-play).
 */
export function regionalKitOnWire(product: Pick<ShardFolder, 'has' | 'shardfile'>): boolean {
  return product.has('sim/runtime-plan') || product.shardfile.runtime !== null;
}
