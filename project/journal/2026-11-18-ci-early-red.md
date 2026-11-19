# Cancel a red main run behind a newer push

> Written by: Claude (opus-cispeed)
>
> **State:** meta FLOW-SIMPLE FS24, J435 (the J422 freeze lifted).

Main's ci group keeps the running run and only the newest pending one
(CIQ1). With pushes a median 4 min apart and runs a median 17 min
(p90 29), a fix waited for the run ahead of it. 44 of 79 runs that ran
in 26 h were red, and each ran on a median 8 min (p90 20) after its
first blocking failure, 374 min in all.

`ci-early-red.yml` runs on every push to main: when the running main
run has a finished failed blocking job and a newer push run is pending,
it cancels the running run so the pending one starts. main-watch
already reads a started run cancelled with a blocking failure as red;
it now names only the jobs that failed, not the ones the cancel hit.

Replayed on the same 281 push runs: verdicts 82 to 111, push to verdict
median 31 to 21 min, push made while main was red median 34 to 20 min,
job minutes +2 %. Cancel-in-progress on every push gave 15 verdicts in
26 h (a 300 min gap), so it was not taken. Cancelling from the failing
job itself (when the newer push came first) would add 13 more verdicts;
it needs a step in five jobs and is a follow-up if this one holds.
