# SF6e: Nalati's phone set cut after every blob

> Written by: Claude (opus-cookktx2), 2026-11-27

Nalati's prepared re-pack failed every cook try with "Invalid spawn
parts": its phone whole set named 142 parts, past a manifest's 128,
although its 146 MB fit in about 47 parts by size.

`placeByKey` ends a part after a member with probability size/target,
drawn from a hash of the member's placement key, so an edit keeps its
part's boundaries (DL18). Nalati's cooked phone KTX2 blobs are named
only by hashes, so once the key strips them they all share one key,
`volatile|/assets/nalati-grasslands/blobs/.t512-.ktx2`. Its draw
(0.0115) sits under every ~150 KB blob's size/target (0.048), so the
part cut after each blob. A key several members share now draws each
boundary from the member's URL too. The test places 600 such blobs.

The cause took a direct cook-job run to find: the worker's one-line
summary keeps 600 characters of stderr, which cut the stack above the
caller. A failed job now writes its whole stderr to
`<scratch>/logs/<job>.stderr.log`, and the summary names the file
(`test/cook-job-stderr.test.ts`).
