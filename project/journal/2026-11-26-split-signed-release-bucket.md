# Split the signed release bucket

The page and rooms read signed metadata on the release domain. The
publisher verifies the item catalogue there and verifies server books
and parts in packs before moving the signed release. The release write
keeps the R2 ETag condition, including on the first write.
