# Keep installed-cook deadlines enforceable

> Written by: Codex
> **State:** repaired locally, 2026-11-17; hosted confirmation pending.

Main df4285daf3, run 44092685144 attempt 1, tests (2), lost shard 6's
ordinary report after 300 seconds. Its exact plan has 74 ordinary files;
73 reported results, and cook-astc6-installed.test.ts never finished.
The shard wall reached 428947 ms against 300000 ms. An external rerun
started attempt 2 before main-watch recorded the original failure.

Both original installed-package cases pass locally in 12.50 seconds.
The hosted subprocess stage is unknown: the old test retained no phase
events. Its synchronous calls block Vitest's 90/120-second case timers,
and spawnSync's TERM timeout is not a hard bound. A native control with
a TERM-resistant child remains blocked past its 100 ms timeout until an
independent 1000 ms owner terminates it (observed 1034.79 ms).

Run fixture commands asynchronously through the existing runCommitJobs
owner. Each command keeps its original 60/90-second deadline; Vitest's
case signal cancels and drains the owned tree before fixture removal.
Separate files preserve npm JSON and stderr. Existing output-size
admission remains checked before reading. Retain phase start/finish
events alongside the CI timing report, including failed/cancelled work.

The actual npm pack/install, missing-worker-hook red control, restored
full cook, all four manifests and phone/desktop assertions remain.
Two native controls keep the event loop responsive and prove timeout
(124) and cancellation (130) stop a TERM-resistant child. All four
cases pass under CI markers in 8.41 seconds; this is not a speed claim
because npm's cache differs. No production, pins or gate-budget changes.
