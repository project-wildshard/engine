import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';

/**
 * Whether a regional runtime's kit plays on the server's wire (ONE-FORMAT OF19d). A cell with a native runtime plan has its
 * held weapon run by the server (`installNativeMelee`), and its crack rows wait on that weapon's own lash: off the wire the
 * page's whip cracked the Dunes crank by itself, the page said the bucket was up, and the server, which never heard the
 * crack, refused the well's oil without a word. Such a kit takes the road's wire, as a data cell's does (TC-E1b); a cell
 * whose server holds no weapon keeps its kit's own contacts.
 */
export function regionalKitOnWire(product: Pick<ShardFolder, 'has'>): boolean {
  return product.has('sim/runtime-plan');
}
