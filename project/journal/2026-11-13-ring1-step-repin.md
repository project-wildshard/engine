# Ring 1 step digests re-pinned for GC36

Main's ring1 `step` stage (CI `tests (6)`) failed since GC36
(`af38ba22`, "no chunk-edge walls anywhere"): the native-assembly step
digests of driftwood-isle, nalati-grasslands and pine-hollow differ
from `test/pins/ring-digests.json` (final digest 8bc55183df9223cd,
3cc27467065c3fd4 and 460abb8a48b95762, pinned 95f163f7072ff26b,
f070e4715b70c8c9 and b111b2d5e8789f86).

Proved on this Mac: HEAD gives the new digests; a detached worktree at
HEAD with af38ba22's source changes reverted gives the three pinned
digests exactly. The step's world no longer carries the baked
chunk-edge walls, so bodies step differently near them; this is the
same cause as the Nalati room-frame digests nowall2 re-pinned in
`6e85a6fa`.

Re-pinned: darwin-arm64 from `ring-step.ts --update` here, linux-x64
from CI's own step report (run 43470271599's `ring-cook/step.json`).
The two platforms' chains are identical. The other five ring rows are
unchanged.
