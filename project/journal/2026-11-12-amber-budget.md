# AMBER: a slow test file warns, it doesn't stop the train (J295)

> Written by: Claude

Main run 43288951110 went red on one line: `CI test file 61443 ms exceeds 60000 ms`. Jake, 14:36 Cancún: a 60 s per-file
limit failing main is wrong, it shouldn't stop the staging release, but a warning gets ignored and bleeds, so it has to
sit between the two. Now `scripts/engine-ci-budget.ts` judges each file with `scripts/test-amber.mjs`, where every
threshold lives: over its 60 s budget is AMBER (a `::warning::` and an `AMBER file=… ms=… budget=… run=…` line in the
shard report, job green); at 2x (120 s) it is red, so a hang still fails.

So amber can't be ignored forever, main's timings job keeps a ledger, `amber` in the measured timings table (Actions
cache): each main run that measures a file over budget extends its streak; only 3 main runs in a row within budget clear
it, so a file hovering at 60 s still escalates. Every run reads that ledger, so a file amber on main for 24 h, or on 12
main runs (about 3 h at today's pace), is red again, on plan branches too. land's TS10 flaky re-run no longer names an
over-budget file, and never re-runs a file red on time. The timings job repeats the run's AMBER lines as annotations (a
main run that reused its plan-branch run has none of its own), and `main-watch` turns them into one `main AMBER <sha>
<file> <ms>/<budget>` receipt per file; the coordinator hands each out as a queue-skipping fix row the same day (meta
HOW-WE-BUILD-PLAN). A `claude -p` review (J206) found that MUST in land and four SHOULD/NITs (hovering files, a fetched
table's ledger, GitHub's 10-warning cap, an annotations read that could stall main-watch); all folded. Left: two main
timings jobs saving at once can lose one run's count. The pre-push has no per-file limit, only a total-time warning, so
nothing changes there. The shard's 300 s wall is still red.
