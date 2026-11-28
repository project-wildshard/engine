# 2026-11-27 A phone reads a material's image as the cook's KTX2, at material time (SF28)

A WebKit phone boot with both forms of each cooked blob left out of the lists showed which form each reader fetches. For
an image blob a material reads through the KTX2 table (look maps and graph params, prop textures and slots, skin looks)
the renderer draws the cook's KTX2, but shardfile admission (`folder.ts`, through `readAsset`) still read the PNG or JPEG
and nothing used it.

The first try (opus-batch's patch) swapped the image for its KTX2 at admission. It could not land: in the session boot,
admission runs before `setTexturePolicy` and before `prepareShardAssets` registers the shard's KTX2 table, so nothing
stood in at admission, and the images were then read from outside the lists (WebKit Pine 164.3 MB, up from 157.8).

So the decision moved to where the mode is known. The cook leaves a table image out of the phone's lists when its KTX2 is
listed (cook 1.21.0). Admission leaves such an image unread when the page's download lists its KTX2 and not the image:
that needs no texture mode and no table, only the listing (`spawnListedBlobKtx2` finds the KTX2 by its path,
`blobKtx2Hash`). It is kept out of GC9's warm and the release lists. When the material compiles, `cookedBlobBytes` reads
the KTX2 for a ref with no admitted bytes, checked against the sha256 the download lists for it; a page that reads images
(a GPU the probe vetoed) reads the image by its product URL through `ClientAssets.standInReads`, checked against its hash.
Every `clientMaterials` caller passes those reads: the session client, the native runtime's looks (which no longer read a
stand-in through `read`), the regional world and the grid's tiles. A data cell's grapple claw passes none; on a vetoed GPU
a stand-in there is refused by name, as a missing texture always was.

Only table readers change. A named image stays listed (a reader that names it decodes it raw): Nalati's horse atlas is a
skin's map and a posed specimen's atlas, and the first build fetched it from outside the lists (0.56 MB). Lightmaps, lent
textures, UI and journal art and glTF images read as before.

Measured on a headless WebKit phone boot (402x874, service workers off, whole download done) against the gate:
Pine 142.55 to 134.46 MB of its own bytes, gate 139.65 to 131.55; Nalati 125.31 to 115.08, gate 124.88 to 114.62. The
table images were 7.5 and 9.5 MB, not the 12.6 and 17.5 MB first estimated.

Guards: `test/stand-in-admission.test.ts` (the image is never read or warmed; the KTX2 is checked and a tampered one
refused; a vetoed page reads the image, checked; an image off the table, listed, or with no listed KTX2 reads as before)
and `test/phone-ktx2-not-source.test.ts` (the phone set lists the KTX2 alone; a named image stays listed; the page's path
rule names the cook's KTX2; UI art has no KTX2).
