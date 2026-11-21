# FS30 Dunes Explorer texture lifetime

WebKit Dunes Explorer uploaded zero bytes into a 2048 x 2048 RGBA8
texture after an earlier thumbnail retired. The disposal trace ended
at the thumbnail's scene lease. The texture and three.js source
versions and the sampler were unchanged, so the later draw was
reallocating a disposed GPU image with no decoded CPU copy left.

Register loaded material textures with the catalogue's scene owner.
Temporary specimens can borrow them while the catalogue lives.
Texels still release after the original upload. A focused regression
failed on the first thumbnail's disposal before the change and now
checks two borrowers and the final catalogue disposal.

The rebuilt Dunes r5 catalogue drew all 12 real WebKit thumbnails
with no faults. The four focused suites passed 37 tests.
