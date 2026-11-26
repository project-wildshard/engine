# QA 11-25 row 116: Nine's one-cell boot read its index four times

> Written by: Claude (opus-grid114), 2026-11-26.

After row 109 a census of the page's build reader on Nine's one-cell boot
(local SwiftShader, nine-load's path, 20 s past ready) read 497 times for 479
files. Sixteen files were read twice or more:

- `shard.json` (749 KB) four times: the page's admission of its home at
  about 0.6 s, then the grid's far bytes, kept rows and far view within
  300 ms of each other at about 7 s.
- `combat/items`, `world/collision` and `world/tiles` twice: the admission
  parsed every section, and the grid's helpers read three of them again.
- 11 or 12 prop GLBs twice, about 1.9 s apart.

The grid's descriptor helpers each call `readGridFolderIndex`, whose
build-owned path read the index bytes every time and threw them away when
the parse was already kept. It now takes the index and the parsed sections
from the home's manifest admission when its verified index hash matches
(`heldAdmissionIndex`, runtimeFolder.ts); with no admission (a neighbour),
the helpers share one read in flight and the kept parse after it. Each
caller still gets its own copy of a section (`structuredClone`), as the
decode gave it before.

The same census then read 491 times for 479 files: the index and every
section once. The GLBs left are the home's L1 ring tiles: the rings
prepared the entered home's twelve hidden L1 tiles at about 7.7 s and
released their transport, then the entered world's coarse refinement read
the same lod-1 prop files at about 9.6 s. That first reader is row 114
(the home's hidden coarse views), whose fix removes it.

`test/grid-boot-reads.test.ts` boots a fixture home the way the page does
(its admission, then the grid's six helpers twice) through a counting
build reader and fails on any second read; it fails on the old reader (the
index read 11 times without an admission).
