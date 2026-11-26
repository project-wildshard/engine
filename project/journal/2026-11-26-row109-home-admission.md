# QA 11-25 row 109: the grid page kept its home's admitted product

> Written by: Claude (opus-heap109), 2026-11-26.

A grid page boots a shell (`pageShell.ts`), while its home cell's product is
admitted under the cell's catalogue manifest (`findShard(slug)`). The boot's
js-heap H6 release in `finish.ts` freed only the shell's admission, which has
none, so Nine's whole admitted product stayed held after boot.

A read census of nine-load's local boot (a probe on the build reader) showed
why the earlier try at releasing it looked worse: the one-cell boot read Nine's
files 1,602 times for 478 distinct files. The manifest admission read 415 of
them at about 1 s; the grid's own admission of the same home read 290 again at
about 5.6 s, its input leases read 256 again after its metadata release, and its
cell readers read about 500 more. Nothing re-read the released files after the
boot: on Metal the measure only raced the after-control build.

The fix serves a file the manifest admission still holds from that admission
(`heldAdmissionBytes`, in the page's build reader, so the grid's admission, its
input leases and its cell readers all take it), admits the grid's home from the
installed source instead of reading the descriptor again, and releases the
home's admission at the end of the boot (`releaseBootTransport`). The same boot
now reads 497 times for 478 files; what is read twice is the grid's own
descriptor helpers and 11 model files its reader releases and reads back.

Nine's boot rows, nine-load's local boot, the same build with the fix on and
off: SwiftShader live heap 218.8 and 218.9 MB against 252.8 to 262.1 MB,
geometry 6.8 against 7.8 MB. Metal 15 s after control (where the after-control
build has settled): 204.0 and 204.2 MB against 249.4 MB, geometry 5.3 against
6.3 MB. At nine-load's own read, about 5 s in, Metal catches the after-control
build mid-way in both modes (23.6 and 313 MB without the fix, 29.9 and 276 MB
with it, and 9.8 and 237 MB on a lucky run): that race is its own row (meta QA 11-25 row 115).

The coordinator's lead, the one-cell page keeping its home's twelve L1 ring
tiles and far proxy while entered, holds 21.7 MB of residency claims but no JS
heap or CPU geometry here (233.0 against 231.1 MB with them cut): a separate cut (row 114).
