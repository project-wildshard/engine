# Native witness checkpoints

Driftwood, Pine Hollow, Sky Reach and Nine Dragon retain their TypeScript command tapes and recorders in their proof folders. Their generated gzip checkpoints live in the shared content-hash cache, outside git. Each committed `checkpoints/manifest.json` carries the DO-NOT-EDIT notice, payload hashes and recorded outcomes.

Prepare a clean checkout before running bounded native tests:

```sh
pnpm gen
node scripts/witness-manifests.mjs --prepare .
```

A cache miss plays the real recorder into an isolated directory. A hit verifies every output hash before admission. To regenerate and compare a particular witness, run:

```sh
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/driftwood-isle/run.mjs compare-checkpoints
```

Replace the slug for another witness. Exact comparisons against the committed payload hashes are normative on Darwin. Linux generates and validates its own native output, then runs the same continuation proofs; it does not compare floating-point snapshots against Darwin bytes. Deliberate behaviour changes use `run.mjs checkpoints` to update the small manifest; the pusher handles unchanged-outcome input refreshes.

Recorders write version 1 snapshot wires through `simWireV1` (`test/fake/simState.ts`), and digests hash the version 1 field shape, because every committed hash was taken in it (P1-E5.2a). So an unchanged hash proves the version 2 engine reached the same state byte for byte, and every checkpoint load goes through the v1 → v2 migration. `test/fixtures/sim-snapshot-v1.json` pins four more saves from the real version 1 writer. Neither is ever re-recorded to make something pass.

The source payloads were retired after the push gate and Linux CI passed at `ae913bcc2` ([run 38061317459](https://github.com/Raynos/project-wildshard-singleplayer/actions/runs/38061317459)). CI shard 3 had no native cache and prepared all four witnesses successfully. The generators and hash manifests remain committed.
