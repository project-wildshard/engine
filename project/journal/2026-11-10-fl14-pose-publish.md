# FL14: a pose nothing reposed does not republish

`test/driftwood-long-session.test.ts` runs 24.5 s alone but 59–85 s on CI
against its unchanged 60 s budget. The roster publishes every native pose
every step: 8.9M publishes, 174M joint comparisons, of which only 3.3M
joints actually changed. 91% of publishes took the existing "same" path,
yet each still compared every joint and recomposed the root frame.

`NativeCreaturePose` now tracks which joints were covered by a publish
(`cleanThrough`) and whether the root is unchanged since its frame was
composed (`rootClean`). Locals change only in advance (its quadruped and
`animate` writers run inside it), adopt and restore, and each marks both.
A publish with nothing marked, a covered `through` and a solved chain
returns before the loop: the old path would have found every joint and
the frame identical and written the same published values.

The Codex J206 review found one MUST: a caller that borrows `bones` or
`context` may keep a joint and write it later. Those properties are now
getters that set `borrowed`, which disables the shortcut for that pose for
good, so patrol, taming and legacy limb restore keep the full comparison.
The Driftwood roster never borrows; its `animate` path uses the internal
context during advance.

Proof, all local: 48 checkpoint digests of the test's own flow (every
100 s of fill and 1,200 s at capacity, the wire, the restored world and
the 300 s two-world suffix) are byte-identical before and after. An unsafe
variant that skips the mark in advance changes 47 of 48, so the digests
see a missed publication. The original test passes unchanged; 71 related
roster, pose and headless files pass 289/289 before and after the fix.

One-slot admitted ABBA, four runs each: file 24.52/24.82/26.05/37.57 s
before, 21.02/21.19/21.59/23.30 s after (median about 25.4 to 21.4 s).
Admitted CPU profiles: pose publish 4.57 to 1.13 s, publishPoses 5.01 to
1.41 s, total sampled 26.28 to 22.43 s (-14.6%). Numeric channel evaluate
and apply are unchanged and belong to codex-pinefix2. This is a source cut,
not ten hosted greens; the 60 s budget, roster bound, 1,200 s session and
every assertion are unchanged.
