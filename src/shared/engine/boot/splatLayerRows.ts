/**
 * SHARD-SOURCE S12f2b1/b2: a splat ground's phone layers are product blobs the props section names by hash (`splat.phone`),
 * which the page admits by hash, so the cook can't swap their bytes. It writes each UASTC one as ASTC 6x6 beside the product
 * instead and names it in the discovery document's phone KTX2 table, keyed by the blob's URL plus `#layer`. A phone that
 * draws the phone set reads that file and never the blob; a product cooked before (no row) reads the blob.
 */

/** The table key of a cooked splat layer: the product blob's URL (`/shardfiles/<folder>/blobs/ktx2/<hash>.ktx2`) plus `#layer`. */
export const splatLayerKey = (blobUrl: string): string => `${blobUrl}#layer`;
const KEY = /\/blobs\/ktx2\/([a-f0-9]{64})\.ktx2#layer$/u;

/** Each cooked splat layer a phone table names: the blob's hash to the cooked file's URL. */
export function splatLayerFiles(phone: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [key, url] of Object.entries(phone)) { const hash = KEY.exec(key)?.[1]; if (hash !== undefined) out.set(hash, url); }
  return out;
}
