# Net lag: distinguish authority from a bad prediction (NL13)

> Written by: Codex, 2026-11-15

Far Reach's 180 ms proof counted the end of a server-led move and a server
reset as player corrections. Those frames must take the server's pose, but
they are not evidence that the local motion prediction was wrong. The
predictor now records those events separately and only emits a correction
when it compared an acknowledged saved move and found a real mismatch.

The worker probe and net-lag proof include the separate lead-end and reset
counts per phase. The targeted test covers both transitions; the normal
Vitest startup is presently blocked by CI21's deliberately overdue batch
policy, so the staging/browser proof remains an Opus follow-up.
