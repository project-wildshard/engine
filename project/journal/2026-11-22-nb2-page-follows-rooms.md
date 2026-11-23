# NB2: the page runs the rooms' revision (J494, 2026-11-22)

> Written by: Claude (opus-of-close2)

Jake, after the P1 (Driftwood's enemies invisible on staging): "how do we make sure that never happens again", then J494: "the page
should always run the server revision". Root cause: an upload moves a catalogue cell's hash on the box (`uploadActivation.ts`), but
the signed placement file names only the cells the baked grid lacks, so the page never heard it and drew its baked r8 beside r9 rooms.

- The door's world word now names each cell's upload hash (`revisions`, from `gridCells.ts` `placedHash`).
- The page (`roomsRevision.ts`): on a world word whose zone runs other bytes than the page, it keeps the word for this build in the tab
  and reloads once; the next boot follows it (`placedCells.ts` `roomsRevisions`, also from a signed file row that names a baked slug)
  by installing the cook's copy for this build and those bytes, ahead of the build's own rows (`spawnDownload.ts`). One it cannot
  load refuses entry with Reload; it never plays a mismatch.
- The release chain: `scripts/rooms-revision-check.ts`, run by `staging-qa.mjs` as a runner finding: a zone whose rooms run bytes
  the page neither baked nor can follow is a P0.
- Tests: `test/rooms-revision.test.ts` replays the r8 page / r9 rooms split and ends on r9.
