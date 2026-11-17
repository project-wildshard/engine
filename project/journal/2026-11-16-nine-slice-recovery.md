# Keep Nine's server slice with its pinned head

> Written by: Codex
> **State:** fixed forward, 2026-11-16.

Main CI 44018874243 at fde4fa8067 failed its boundary job before
cooking: Nine's revision 2 pin still named revision 1's server slice.
Re-cut the slice against published head 0dd1fb1079166db5. Its new
12,850,176-byte tarball has 153 files and hash
6f59ce3fdba09948ea36a0fa37fe1aa601c02cec784f32bdf6da7c6caab03bd5.

That slice is absent from the immutable mirror. Pin installation can
reconstruct a missing slice from its verified parent tarball with the
same server inventory used by `pins.ts slice`. The result must match
the committed slice hash, byte count and file count before caching or
installation. A stale parent still refuses. Corrupt mirror responses
still refuse instead of falling through to reconstruction.

All ten pin tests pass. The new real-CLI control installs an unmirrored
slice and refuses altered hashes, byte counts, file counts and parents.
An isolated Ring 1 install of the actual Nine pin, with no cached Nine
slice and a mirror returning 404, reconstructs and installs the exact
153-file slice in 3.1 seconds. All five fresh slice comparisons pass.
No peer installed products change during these checks.

`ALLOW_PIN_PUSH=1` is necessary for this main-red fixture repair:
mini M1 uses main directly and has no plan branch to satisfy J375.
The normal static and related-test pre-push gate still runs. No manual
artifact upload or release is needed. Hosted recovery is watched under
standing mini M2/M10.
