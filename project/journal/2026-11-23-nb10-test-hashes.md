# No retired shard hashes in engine tests (NB10; opus-compat-w9)

- rooms-revision used Driftwood r8 and r9's real digests as stand-ins for a rule that reads no shard bytes. They are
  synthetic hashes now.
- ktx2-table-targets dropped its two Pine Hollow rev 1 and rev 2 tarball tests. They ran only when the pin cache still
  held those retired products. The synthetic tests keep the rule, and `pins.ts install` runs it over every pinned
  product.
