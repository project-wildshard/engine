# SP4: fingerprints in CI

> Written by: Claude (opus-compat-w5), 2026-11-23

`scripts/fingerprints.ts --base <ref>` prints whether a push moved the renderer
fingerprint (SP3), the cook revision (SP7), the format version and the
migration chain id. Job 1 of ci.yml prints it into the run summary; it never
fails a run.

Replay on three real pushes (`--base <c>~1 --head <c>`):

- `8a4bc17c6` perf(grid) DF9 DF10: renderer moved, cook moved, format same.
- `96c69fb7a` docs(saves): nothing moved.
- `59434c53f` feat(shardfile) CP14 (format 0.68.1 to 0.69.1): renderer, cook,
  format and chain moved.

The base side reads only the push's changed files from git, so it runs in
about a second with no second checkout.
