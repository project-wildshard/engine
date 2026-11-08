# Preserve shared-frame fairness without starving tiles

The first complete normal pre-push correctly refused publication:
5800 cases passed, but two existing shared-frame checks failed. The
initial yield-once repair let both expensive queued warm-ups issue in
frame 1, where the checks require the second to wait for frame 2. The
whole full-test lane took 794.99 s. The assertions remain unchanged.

Track atomic compile admissions with a weak, per-renderer revision.
A spent-budget waiter records that revision before its completed-frame
yield. If another warm-up issued while it waited, recheck the shared
budget and yield again when spent. If no warm-up issued, admit this
one atomic job even when the draw already consumed the budget. A slow
draw alone can no longer perpetually refuse all work, while expensive
queued compiles retain their separate frames. Cheap work still batches,
and cancellation and post-job GPU/budget fences remain unchanged.

All fifteen existing precompile files, 101 cases, pass in 1.15 s,
including the four fairness/cancellation cases. No check, cap or timeout
is weakened and no new hook or coupled fixture is added. The full
28-product rebuild completes in 30.34 s. Its version prefix is 4aa7d60
because this forward scheduling repair remains uncommitted for its real
crossing proof. This records that fact rather than claiming those bytes
were already part of the earlier committed build.

The revised scheduler passes the actual road crossing again in default
Chromium SwiftShader (4583 completed worker frames) and WebKit Apple GPU
(5639). In each actual Ember entry, current/inside/server all agree on
open-plot-4-1, readiness is true, phase settled, board and closed server
null, issues empty. Both then earn and resume the durable saved pose
through the real title GRID tap within 3 mm. No movement, readiness or
completion event is emitted by the proof in place of real play.

All four strict cases pass again: Dunes Chromium/WebKit 23.8/3.4 s and
installed _template 13.7/3.2 s, each with zero stalls, backwards,
untraced changes or page errors and complete native clipboard readback.
The grid card's genuine SwiftShader GPU stalls remain reported, not
converted to fabricated progress. The whole normal gate must run again
with the proof browsers closed; focused checks alone cannot publish.
