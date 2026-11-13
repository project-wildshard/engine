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

## S12c: the cook's own ASTC 6×6 (opus-s12c)

`cook --phone-astc6` (implies `--phone-textures`; still off by default) gives `phoneTier` an encoder: each phone row is
cooked from its desktop master (the same source key, or its name without `.phone`), trimmed to its tier size, then
re-encoded as ASTC 6×6 by `basisuAstc6` (`src/cook/game/astc6Encode.ts`): basisu's own transcoder decodes the trimmed
UASTC master to RGBA levels (`-export_dds RGBA32`) and S4's flags encode them (`-ldr_6x6 -effort 4`, sRGB / linear from
the DFD, `-normal_map` for a material's normal or a `nor` name). S4 baked from source JPEGs; a cook has only UASTC, so this
re-encodes lossy data and goldens judge it. A master stands in only when the encode ran; a GLB takes only the same
source's desktop file, because Pine's `.phone` GLBs hold lighter meshes (creatures, NPCs, weapons: 30–45% fewer vertices).
Raw ASTC is only trimmed, ETC1S kept, a one-level, array or cube master never encoded. Cached by input hash in
`~/.cache/wildshard/gen/astc6/1`.

Pine's phone table (`scripts/tier-textures.mjs out/pine-hollow --astc6`): today 28.31 MB file / 32.21 GPU; the cook's
6×6 table 22.44 / 22.59, 21% under. The rest of the drop is rows S4 left UASTC (creature and viewmodel maps, the
"stay 4×4" call) now 6×6 too. Cooking the rev2 shardfile: phone entry 90.29 → 88.75 MB; phone whole 90.29 → 95.50,
because 51 phone files a fence shard reads past its fence (viewmodel maps and the like, read from desktop parts today)
now ride in the phone whole set, S12b's birds case at scale. A warm recook: 0 encoded, 57 reused.
