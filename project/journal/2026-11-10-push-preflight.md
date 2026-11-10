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
