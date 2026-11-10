# Admit Template 2 from the installed dependency

J233's first dependency seam is an explicit command:
`node scripts/pins.ts install --from-format blender-template`.
It reads the product shipped by the frozen format dependency, serializes
its regular files through format's own tar writer, then takes the existing
pin installer and its full product validator. It skips API, fallback-asset
and released-save fetches. The validation receipt records the source and
index hash; `pins.ts status` reports that provenance.

The actual command under macOS sandbox-exec with all networking denied
refuses the original source with `Not pinned: --from-format`. The new
command admits 170 files in 0.2 seconds. A read-only baseline also runs the
real validator in 82.6 ms: 2,624,218 raw bytes, 2,762,240 tar bytes, hash
fbd3aba57d66811ef4bc2ecda1b6c4bfd23e6d55a2f54eb85c6a7cbb28316f02.
That is exactly the current API pin's archive, not a new cook or fixture.
The dependency is shardfile 4f8280c58ab6e527aa9735eaa80fccf1f34ab6d3.
`scripts/template-format-proof.mjs` reproduces both actual CLI outcomes
under the network sandbox in 1.72 seconds, including its own cleanup.
It runs explicitly outside hooks. The J206 one-shot review reports no
MUST-FIX or SHOULD-FIX items for the dependency entry and provenance.

This is an entry seam, not whole-row completion. The normal and Ring 1
install commands still use their existing API pins. Removing the redundant
Template 2 API row and wiring a dependency catalogue belongs in the next
slice, together with the real-title smoke. None of the three client options
has been timed yet; no 15-second or 60-second pass is claimed. T2E-1 stays
open and the plan remains 0 of 29 rows done. No browser or hook was added.
