# A splat ground draws from its images before the cook (SF24)

Pine Hollow's publish stopped in phone WebKit prepare with "props.splat
colour: its four layers must be compressed KTX2". The images-only re-pack
carries Pine's twelve terrain layers as JPEGs and the cook makes their
KTX2 (J525), but `wildshard prepare` records before any cook, so the page
had four decoded images and `splatArray` took compressed layers only.

It was not v0.1.100's age: Pine's prepare refused the same way locally on
v0.1.100's preparation client and on one built from main 29999d8b0. The
phone-copy fixes (e459758fa, d004df219) are about `phoneUrl` and never
reach the splat arrays.

`splatArray` now takes four image layers too and makes one RGBA8
`DataArrayTexture` at the largest layer's edge (capped at 1024),
mipmapped by three, the way the live terrain's image path
(`loadPBRArray`) does. A cooked page still reads the cook's KTX2 and gets
the compressed array; a set mixing compressed and image layers is still
refused. The texels go once uploaded, as a raw-texel KTX2's do.

Proof: Pine's `wildshard prepare` against a preparation client built with
this change entered in 7 s and recorded 102 programs (fence 506). Guard:
`test/splat-image-layers.test.ts`, red on main (4 of 5 failed).
