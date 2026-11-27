# 2026-11-27 A home-baked page lists a zone's mounts and serves its loose ones (SF11)

With SF11 no pin copies a zone's mounts under `public/`, but the build's own manifests (`writeSpawnManifests`) still
listed only a zone's folder rows and its own audio, and wrote none of its mounts loose. Every page built by
`build:game` (the dev server, the local staging QA rig, CI's boot smokes) then 404'd on zone files: Driftwood's
`fp-arms.glb` (K3), Pine's code parts, both zones' `/programs/<slug>.json`, Dunes' sky image (tests (9)), and Nine's
boot stalled (nine-ring1). nightly-heads missed it: its heads boot from cold cooks, which list every mount.

The build now lists a zone's mounts as the zone's cook does (`cookShard`: folder rows plus mount rows per set), so they
pack into the zone's parts, and writes what no part may hold (images, `/programs/`) at its URL. SF12's removal of the
four title portraits also left two stale counts (`title-asset-urls`, `pwa-update-cache`) and an `index.html` lookup that
set `url("undefined")`; those are fixed with it. Guard: `test/home-baked-zone-mounts.test.ts`.
