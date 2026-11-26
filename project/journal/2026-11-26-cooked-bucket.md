# 2026-11-26 — Cooked pack addresses

PV25 starts with a new empty R2 bucket at cooked.wildshard.io. Keep the raw
shard version and both cook inputs in every index address. Readers use the
same builder and reject object paths that cross a shard version. The bucket
gets its first live cook through the new publisher as soon as that path is
ready. This step provisions the bucket and lands the key contract.

The index parser now checks both the cook identity and every object path.
The mount table points only to entries already in the index's object table.
