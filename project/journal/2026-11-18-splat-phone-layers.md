# A splat ground's phone layers cooked 6x6 (SHARD-SOURCE S12f2b1, S12f2b2)

- A splat ground's phone layers are product blobs the props section names by hash, and the page admits them by hash,
  so the cook can't swap their bytes. Pine kept a hand-made 6x6 set for them (`astc6/`), the last such set.
- Cook (`splatPhoneTier`, `shardHalf`): each UASTC colour and normal layer of `splat.phone` is encoded 6x6 at its own
  size to `/assets/<folder>/splat/<hash>.t16384-<hash8>.ktx2` and named in every phone table of the discovery document
  under the blob's URL plus `#layer`. The phone manifests list that file and drop the blob; the desktop keeps the blob.
  A role whose layers can't all be encoded keeps its blobs (one array, one format). ARM stays as it is, as the hand set had it.
- Pine's phone masters turn out to be its desktop layers' own files, so a layer both sets name is cooked for the phone
  and read as it is on a desktop.
- Page (`splatLayerFile`, `cookedSplatLayers`, `cookedSplatBytes`): a phone drawing the phone set leaves a cooked layer's
  blob out of its selection and reads the cooked file by URL (a phone part answers it), checked against its name. No row
  (an older cook), or a device drawing the desktop set: the blob, as before.
- Proof: Pine's built product with S12f2b3's rows, cooked with this tree: 8 layers 6x6 (vkFormat 165/166, 1024),
  8 rows in both phone tables, phone manifests list the 8 cooked files and none of the blobs, desktop manifests the blobs.
- Not done: the grid's phone prefetch of a neighbour's index (`prefetchIndexCore.ts`) runs off the page with no table
  registered, so it still reads a neighbour's layer blobs.
