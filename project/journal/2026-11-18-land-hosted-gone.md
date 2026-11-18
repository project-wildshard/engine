# land.mjs: the hosted land is gone (J422, meta FLOW-SIMPLE FS5 slice 2, opus-flow2)

J422 made push mode the one way onto main: rebase, the split push gate, push main, main-watch follows. The hosted land
(J240, J249, J258) stayed beside it only so lands already in flight could finish; none has run since the switch.

Deleted from `scripts/land.mjs`: `--hosted`, the plan-branch push and its ownership lease (`pushPlan`, `reached`), the
Actions wait (`waitCI`, `quotaWait`, `ghApi`, `failedJobs`, `runFailures`), `refreshPlanTip`, `verifyReplay`, the
preflight (`localChecks`, `preflightSteps`, `CHECK_CSS`), the `exact`/`carried` main pushes and the origin plan-branch
delete in cleanup. `--poll`, `--timeout` and `--appear` went with the wait; `--no-preflight` and `--no-watch-main` still
parse as no-ops for old callers, and `--hosted` stops with a pointer to J422. From the hook: `run-checks.mjs`'s `exact`
branch, `push-checks.mjs`'s `landMainChecks` (the carried static lane) and those two kinds in `landMainMode`.

Kept: `--local`, `land-local-gate.mjs` and `land-hook-ack.mjs` for the Mac mini (J388); `shaVerdict`, `githubSlug` and
`LAND_WORKFLOWS`, which `pin-provenance.mjs` reads.

Tests: `land-hosted.test.ts` became `land-cleanup.test.ts` and `land-preflight.test.ts` became `land-guards.test.ts`. The
shared behaviour moved onto push mode (main-watch start, canonical follow, LS5/J358 cleanup with `--done`, rebase onto a
moved main, rebase conflict, force refusal, pins and DS22 stamps, the clean-tree stop, the red-gate cause, the rebase
install, two lands at once, ref-lock retries); a peer moves main before land, or a write lands from inside the pre-push,
where the hosted tests used the fake Actions CLI. The hosted-only tests went: quota waits, red branch CI, plan-branch
ownership, carried provenance, verifyReplay and the preflight. The fixture defaults to `WS_LAND_MODE=push`.
