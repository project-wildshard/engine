# S12: tier texture sizes by mip trim (opus-s12)

Jake said yes to S12 (J330). First slice: the cook picks a phone texture size from one master by dropping the KTX2 mip
levels above it, no re-encode. Pine's phone table today is 28.3 MB of KTX2/GLB files (32.2 MB on the GPU), mostly S4's
hand-made 6×6 / 512 sets. Trimming the desktop masters to 512 instead gives 30.3 MB (35.4 GPU): trim alone lands 7%
over, because the masters are UASTC (4×4) and the hand sets are 6×6. So retiring the hand sets needs the cook's own
6×6 encode (S12b); trim gives the size, 6×6 gives the format. Not wired into shardCook yet: tiers share mount URLs, so
per-tier bytes need per-tier names and table rows (S12a).

Browser proof (`scripts/tier-textures-proof.mjs`, local build, phone tier, n=1 each): Pine reaches play with every loose
GLB and KTX2 answered trimmed to 512, on Chromium (`--use-angle=metal`) and WebKit, 0 errors, KTX2 mode, 289 textures.
The loose KTX2 reads go 11.12 → 9.65 MB; scene textures decode 17.83 → 17.60 MB; screenshots differ by 1.4–1.8 of 255
on average (moving sky and grass included). Most of Pine's phone bytes ride in pack parts, which the proof can't
rewrite: that waits for the cook wiring (S12a).

## S12b: the cook ships per-tier files (opus-s12b)

`shardHalf` takes `tiers: {phone: true}` (`scripts/cook.mjs --phone-textures`; off by default, so no live cook or app build
changes). `phoneTier` reads the discovery document's KTX2 table: every phone row's GLB or KTX2 target over its row size
gets its own file, `<name>.t512-<hash8>.<ext>`, and only the `phone` maps move to it. The row size is the author's hint
in the table key: a `#layer` twin and a horizon strip keep their file (S4's 1024 rows), every other row is 512. Phone
lists name the phone file in place of its target; one a fence shard reads past its fence rides in the phone whole set.

Pine from today's product (`out/pine-hollow`), cooked both ways: phone entry 90.29 -> 89.77 MB, phone whole 90.29 ->
90.06 MB (birds.phone.glb 630 -> 297 kB now rides there instead of a desktop part); trimmed planet, tree cards and
impostors (KTX2) and birds (GLB). Desktop manifests list the same files with the same bytes except discovery.json, the
one document both tiers read: it now carries the phone rows. Not run: goldens on a cooked Pine (no local Pine build).
