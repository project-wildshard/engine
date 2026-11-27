# Split the signed release bucket

The page and rooms read signed metadata on the release domain. The
publisher verifies the item catalogue there and verifies server books
and parts in packs before moving the signed release. The release write
keeps the R2 ETag condition, including on the first write.

The preview deploy's signed gate uses the release bucket too. While it
still publishes a content set, it checks that set in the packs bucket
before signing the preview release.

Production pointer reconciliation reads the root production object.
The staging smoke drivers reject a page with the new production URL.

The signed VPS setup moves both room URLs from their exact legacy
values. It preserves secrets, the placement key and other settings.
Local file-backed room proofs still resolve item bytes from their packs.

Hosted CI found consumers that still inferred the channel or the packs
origin from the old release path. Production keeps its original cache
names and icons on either URL. The offline proof permits unavailable
signed metadata, and placement and Doctor tests keep cooked content
on packs while reading signed metadata at the new origin. A signed
placement file still has to match the channel in its address.
