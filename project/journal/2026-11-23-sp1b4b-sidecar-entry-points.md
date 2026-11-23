# SP1b4b: the sidecar at pins install and the app build

> Written by: Claude (opus-compat-w6), 2026-11-23

SP1b4a wired the cook worker. The other entry points now find the same
sidecar the same way: `sidecarPath` and `sidecarIn` in `cookSidecar.ts` look
in a host's folder for `<hash>/<renderer>.tar` (a 64-hex shardfile hash and a
hex renderer fingerprint; anything else is no sidecar), and the worker uses
the same lookup.

- **The app build's catalogue cook** (`writeSpawnManifests`, which also
  gives the entry totals): `BuildHalf.sidecars`, set from
  `WILDSHARD_COOK_SIDECARS` in `appCook.ts`. A product installed from a pin
  records its hash in `validation.json`; the cook opens it with that pin's
  sidecar on the build's renderer and says `prepared by cook: <slug>` on a
  hit, or the miss or corrupt line and `stale preparation` otherwise.
- **Pins install**: a stale preparation with a sidecar in
  `WILDSHARD_COOK_SIDECARS` opens as the cook would, and the admit line says
  `cook preparation` and `prepared by cook: <slug>` on a hit.

`test/cook-sidecar-entry-points.test.ts` cooks an installed Brasscap
(author on one renderer, the build on another) through the files-only app
build cook with a hit, a miss and a corrupt sidecar, and checks the lookup's
refusals. No host keeps a sidecar folder yet: the record job is SP1b3.
