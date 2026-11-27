# 2026-11-27 The app build reads a zone's own mounts (SF11)

The SF10 to SF12 batch passed its tests, lint and typecheck, but nobody had run `pnpm build:game` on it. It failed twice
on files that only the old pins install had copied under `public/`. First, `checkBakedTextures` wanted every zone's
declared boot images in `public/` (386 files). Second, `writeSpawnManifests` read a zone's boot recordings (Driftwood's
own island score) and its public inventory rows (Far Reach's fan hand) from `public/`. Both now fall back to the zone's
own mounts. The check takes a row of the declaring zone's `cook.json` mounts whose file is in the product (under
`mounts/`, or over a blob, which is how an images-only upload carries Driftwood's horizons and Pine's painted maps), and
the manifests take the zone's own mount row (`ownMountRows`) with the shard as its source. Engine files still have to be
in `public/` or the build's output. Nalati's old upload still declares 28 files it carries nowhere; its images-only pin
clears them. Guards: `test/output-products.test.ts` (a zone's own row counts, another zone's or a gone file does not) and
`test/cook-own-sfx.test.ts` (the lookup finds a zone's own file by page URL, never an engine one).

The headless boots then found the page side of the same gap. Driftwood and Far Reach passed all five phases, but Pine's
Explorer (explore=model, phone tier) refused at level.data: "sky declares /assets/pine-hollow/hdri/...sky.jpg but
public/assets has no such file". `declareTotals` sizes a boot file from the page tables only, and those no longer list a
zone's files. The session now sizes each file the tables don't know from the zone's cook (`spawnMountSize`: its download,
else its part table) before it totals them. Guards: `src/client/engine/boot/extras.test.ts` (a zone's own sky is unsized
until sized) and `test/spawn-mount-size-whole.test.ts` (a phone-only file past the fence is sized from the phone whole set;
a file no set carries stays unsized and is refused by name).

Chasing the next refusals showed a cook gap, not a page one: Pine's `baked/rain.phone.bin` and eleven phone `.glb` LODs were
in no set and nowhere in the cook's store, so no page could read them. Client fallbacks tried on the way (sizing from the
desktop set, sizing by a read, routing to the home store) only moved the error and were dropped. The cook fix is its own
commit (cook 1.19.0, `2026-11-27-phone-only-whole-set.md`).
