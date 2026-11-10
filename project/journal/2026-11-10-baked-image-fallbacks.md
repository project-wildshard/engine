# Publish the baked image fallback for every tier

Exact engine 4aaccef, full 28-product build, reproduces the reported
level.data failure in native Simulator Safari without a texture pin:
Driftwood declares giant.phone.webp, but its byte inventory omits it.
WebKit with the iPhone UA reaches Ready in Auto/KTX2 mode; selecting the
existing image path reproduces the same failure. The native probe and
rendering remain unchanged.

This was not a post-v0.1.3 deletion or a J196 link change. The six raw
images already lack from 5baa's byte inventory and the initial lifted
products. The C0 recorded mounts include the measured KTX2 files only.
The producer source retains the images. Its mount lists are now fixed
on origin at Driftwood 93d562f and Pine c8d104a.

Frozen engine products must stay usable without a producer checkout.
Six small immutable image pins (181,605 bytes total) carry the exact
published producer Git blobs, source commit/path, SHA-256 and length.
The ordinary pin installer verifies and publishes them through its same
collision-checked ledger. It does not rewrite a product archive, source
hash, preparation evidence, cost or receipt. A future product refresh
removes these bridge pins when the product carries its own images.

The app build checks all baked image/KTX2 declarations in all tiers,
texture modes and flows both before bundling and after publication.
The old product census names six missing images; after pin install all
21 declared baked textures exist. Fourteen focused cases across the
existing pin/publication test files pass in 1.10 seconds, including
corrupt bytes, path escape, tier selection and missing output copies.
Native green-on-candidate and the full normal gate follow this commit;
no release or whole-row completion is claimed here.

The first candidate build caught TS6307: the composite root-test project
needed the new pin reader in its explicit file list. Added it and reran
the complete layer typecheck successfully, without suppressions. The
existing committed publication facts already contain these six source
images. Regenerating against the repaired actual public inventory now
keeps their byte/version rows, with the official renderer stamp.

J206 review found one MUST: a dot-segment URL alias could bypass the
literal ledger collision check. A real pinned reader accepted the alias
on the old code (the new refusal test failed); the forward rejects both
dot forms before publication. Both SHOULDs are addressed: the census
verifies immutable pin bytes in public and final output, including
zero-length and corrupt existing files, and tests cover direct modes,
lookup-map keys, fixed sources, tiers and both page flows. It checks
explicit declarations, not invented implicit filename alternatives.

The quiet native candidate proof then got Driftwood to Ready in 7.2 s
with no console errors, but Pine exposed the next real omission: its
phone horizon. A census of all explicit image-mode declarations, beyond
baked textures, found eleven more missing images (Far Reach five, Pine
four, Driftwood two). The bridge now holds seventeen unchanged producer
Git blobs, 2,192,121 bytes. The guard checks declared raw image modes as
well as baked compressed textures; unused non-baked GPU alias banks are
not claimed as selected reads. All source mount lists are extended too.

Pinned files are bounded and required to be regular files before their
contents are read. Their SHA-256, length and producer Git blob remain
verified afterward. No source/receipt/archive is rewritten.

After the full image census and ordinary pin install, regenerate all
seventeen actual byte/version rows and the official renderer revision.
The reviewed lint selection forward is carried normally so this
formerly generated-only commit still checks the whole declared lint.
Producer mount completion is public at 0dd6e5d/71d4c63/d7693f9; future
producer requests will be batched from the whole mode census.

Native d267 on a fresh origin reaches Driftwood Ready in 7.0 s with
zero native console errors. Pine then exposes an omitted original LOD1
GLB. The complete selected image-mode payload census across all 28
products, both flows and tiers finds exactly nine more raw model files
(Pine eight, Driftwood one). The bridge now has 26 bounded, unchanged
producer blobs (2,899,421 bytes). The guard includes raw model paths,
while keeping separate unused compressed-alias banks out of this claim.
All selected image-mode payloads will be checked before the next proof.

Carry the reviewed selection correction plus the owner's performance
forward normally. The empty generated selection still invokes actual
Oxlint on the same configured staged scope, full typecheck and format;
unknown/missing/non-generated empty selections retain the full fallback.
No ignore configuration, eight-second cap or full publication gate is
changed. Regenerate all 26 recovered rows and official revisions.

Exact c342 native Safari reaches Driftwood loader-complete and the first
game step in its actual IMG fallback. Pine then fails at Spawn detail:
native Network shows three NPC phone GLBs receiving preview HTML. Those
URLs are native texture-map source keys outside the boot file lists.
The whole 28-product, both-tier native model census finds 52 omitted
original GLBs (Pine/Nalati), 13,773,624 bytes, largest 1,146,512 bytes.
They are byte-exact public Git blobs in the frozen source 5f70a2dfe4;
several originals intentionally are not tracked in the split producers.

Pin those originals by immutable public commit/path/SHA-256/length/Git
blob, downloading into the existing pins cache before any mount ledger
change. Streams refuse oversized/corrupt bytes; held bytes are rechecked.
This adds metadata, not 14 MB of duplicate Git binary. No archive,
admission evidence, source hash, cap, renderer or oracle changes. The
build guard now covers native model source keys as well as boot images.
Unused non-model GPU aliases are outside that model claim. The real
HTTP corruption/cache proof and native-key absence proof bring focused
checks to 16 cases under one second. Native final closure remains pending.
