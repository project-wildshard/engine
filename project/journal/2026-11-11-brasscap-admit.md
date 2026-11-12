# Brasscap Mesa from the format dependency (BM-2)

> Written by: Claude (opus-bm2)

- Template 2 is now Brasscap Mesa (meta TEMPLATE-E2E-PLAN, BM rows), a
  sunset canyon shardfile ships as `corpus/brasscap-mesa` beside
  Template 1's `corpus/handwritten` (shardfile 6728203).
- `scripts/pin-format.ts` maps each format product's slug to its folder
  (`FORMAT_PRODUCTS`), so `pins.ts install --from-format brasscap-mesa`
  admits it the way `blender-template` is admitted: same validator, no
  network, no cook. `test/pin-format.test.ts` holds both.
- The format pin moves from 4f8280c to 6728203 to carry the folder.
- Proof: a one-shard catalogue, the e2e watcher's preview and headless
  Chromium pick Brasscap Mesa on Shard Select and spawn at the canyon's
  spawn empty (-1.6, 0.37, 2.6), walk on its floor, no console error and
  no request off the machine. Shot: t2-03-engine.jpg (plan artifacts).
