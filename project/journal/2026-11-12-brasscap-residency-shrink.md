# Brasscap residency shrink (opus-shrink)

- v0.1.14 staging live play logged "[grid] blender-template: admission
  failed ... RangeError: Invalid residency shrink". Brasscap rev 3's
  receipt stamps residentBytes 2,930,740; its files carry 4,670,827
  bytes of wire (the formula gives 5,842,839). Every other pinned
  product's stamp is above its wire. Likely source: shard-format's
  `shardfile pack` reseals a receipt and keeps its old cost fields.
- As a grid neighbour, the transport release shrinks the product claim
  by each released file's compressed bytes, so the claim went below
  zero and the cell stayed closed. Not the home-claim fix (1de80ee2).
- A built product's residency is now max(stamp, wire). The shrink guard
  stays. A stamp still below the full formula undercounts heap; the
  producer fix belongs in shard-format.
