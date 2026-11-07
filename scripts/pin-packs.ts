// C0: a tarball leaves its packs out, because every member keeps its own path. Whoever serves a product rebuilds them, and a
// pinned tree serves its products to the page and to the grid bake.
import { packFromMembers } from '@wildshard/format/product-reads';

type Members = Parameters<typeof packFromMembers>[1];
type Pack = Parameters<typeof packFromMembers>[0];
export type PackedIndex = Members & { readonly packs?: readonly Pack[] };

/** The packs `index` lists and `files` doesn't hold, byte for byte. A pack a tarball carries stays as it came. */
export function restorePacks(index: PackedIndex, files: ReadonlyMap<string, Uint8Array>): ReadonlyMap<string, Uint8Array> {
  const read = (path: string): Uint8Array => {
    const body = files.get(path);
    if (body === undefined) throw new Error(`A pack names ${path}, which its tarball doesn't hold`);
    return body;
  };
  return new Map((index.packs ?? []).filter(pack => !files.has(pack.path)).map(pack => [pack.path, packFromMembers(pack, index, read)]));
}
