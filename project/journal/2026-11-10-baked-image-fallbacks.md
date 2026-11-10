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
