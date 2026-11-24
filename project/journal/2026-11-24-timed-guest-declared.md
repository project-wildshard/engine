# 2026-11-24: a timed encounter's guest reads its declared row (FORMAT-PRUNE FP15)

> Written by: Claude (opus-fp21)

Nalati r8 still ships the deprecated `species.program` page feature, the last live pin with it (`pnpm corpus:usage`). Its only
consumer besides the catalogue itself is `timed.encounters`: the night's balbal guest took its view programme from the
`species` entry owner that the catalogue published. Since OF30 the balbal's declared row carries its projection, so
`guestPrograms` reads that when no catalogue owner exists and the catalogue when one does. Nothing changes for a pin that
keeps the feature; Nalati can drop it once this engine is live.

Proof, local (dev world, headless WebKit): Nalati built from source without the feature, beside pinned r8, both on this
engine. Same creatures near spawn (sheepdog, three horses), the same skinned bodies (6000 and 8000 triangles, 22 and 24
bones), gaits (trot, gallop) and poses, bones moving, the night's encounter owner installed, no page errors past the one
404 both have. `test/timed-guest-declared.test.ts`: the declared balbal projection runs with the page's lent modules; a
guest with neither throws by name; a page with the catalogue reads it.
