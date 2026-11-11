# Land re-runs a flaky red once, then quarantines on two plans' strikes

> Written by: Claude (opus-testspeed-lane)

TEST-SPEED TS10 (J255: "Rerun once; 2 strikes in 24 h → quarantine").
Until now a flaky hosted red stopped `land.mjs`, and a lane re-ran it by
hand (`gh run rerun --failed`) with no record. Today's
`browser-lane` "broken portable lock" red on `plan/ts4a-memo` was one.

Now, when a branch's `ci` run is red and every failure its shard reports
name is a test file (failed, or over the 60 s file budget), land:
- re-runs that run's failed jobs once and waits again;
- on a green re-run, gives each of those files a strike in the machine's
  strike book (`~/.cache/wildshard/flake-strikes.jsonl`, one line each:
  time, file, plan, SHA, run, lane) and lands the plan as usual;
- when a file has strikes from two different plans within 24 h,
  quarantines it under J200: an entry in `test/quarantine.json` owned by
  the standing TEST-SPEED lane, with a 48 h deadline, as a commit land
  adds on the plan before its main push. That commit only adds quarantine
  entries, so the branch's green run carries it (static pre-push, as for
  a clean rebase).
- on a red re-run, stops as before: red twice blocks only its own plan.

A red that isn't a test file (lint, a unit, a shard wall) is not
re-run. `test/land.test.ts` plants a flaky file through the real land
CLI with a fake `gh`: one plan's strike lands it, a second plan's strike
quarantines it on main, and a red re-run stops a third plan with main
unchanged.

Review (J206), four MUSTs fixed: a re-run happens only when every failed
blocking job is a tests share whose red units are all shards with failed
files (its ci-pack and shard reports say so); land waits for the run's own
second attempt; the quarantine commit is dated to its addedAt (J193's
history check compares the commit time), re-dated after a rebase, and must
change only land's entries on the tested HEAD.

Follow-up review: a failed job qualifies only when its packed-share step is
its only red step (the wall check after the upload is not a flaky file);
land waits for exactly attempt 2; the quarantine file must equal the merged
one plus land's own entries byte for byte. The tests add a rebase under the
quarantine commit (re-dated) and a wall-step red that is not re-run.
