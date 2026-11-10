# Queue preflight (DS16c, A16)

Jake: "Queue pre-flight, yeah, sure, do it. Fucking cheap 5 seconds
check before in queue." On 2026-11-10 the queue spent full ~4-minute
gates, and an agent turn each, on bookkeeping it could have named at
enqueue: new test files with no clock (the most common bounce), a
`test/durations-source.json` conflict on the private rebase, a new
browser test wholly skipped in the gate (ValiError "skipped"), and a
plain source conflict.

`scripts/push-preflight.mjs` now runs inside `enqueue`, before capture.
It reuses the gate's own `missingTestTimings`, replays the queue's rebase
per commit with `git merge-tree`, and reads skip conditions with the
gate's env allowlist. It refuses only what is certain; the rest warns.
Stamps only warn because the queue regenerates them after its rebase;
the journal rule only warns because the queue runs no pre-commit hook.

`push-preflight.mjs timings` measures only the new files with the gate's
timing reporter, as the gate's Ring 1 step already does, and records them
with the gate's recorder, so a new test no longer costs a bounced gate.
`merge-durations` keeps both sides of a durations-source conflict until
VB18's union file retires it.

J206 Codex review (six MUSTs, all fixed before landing): the replay now
uses the sequencer's --topo-order; the timing check needs a fully clean
tracked tree, runs in a child under a 15 s hard deadline (fetch 5 s),
and drops files origin/main already has; a skip is "certain" only when
nothing else at file or suite level could register a test and no local
import names the variable; an import or crash of the preflight never
blocks enqueue; and a `<job>.preflight.json` sidecar keeps the verdict
and override when an older live worker rewrites the job without them.

Dogfooding it: `push-preflight.mjs timings` recorded this change's own
test clock in about 25 s (full 11 s, Ring 1 14 s module clocks), and the
56-line record then met the D25 journal rule, so both fix-it messages
now say a timing commit needs a journal line.
- Recorded the preflight test's own clocks with `push-preflight.mjs timings`.
