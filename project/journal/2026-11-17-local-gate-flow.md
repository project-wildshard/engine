# Local-gate landing and one CI runner trip

J400 makes the complete local gate the default worktree landing gate.
The push stays fast-forward-only; no plan ref or hosted run is needed.
Every lost main race rebases and gates the resulting tree again. CSS,
the actual test-slot lease, exact HEAD and checked-tree identity stay
mandatory. Hosted mode remains available with --hosted.

Pin changes retain linked-plan provenance and run the same full gate.
Main-watch still owns the later hosted verdict. WL22's environment and
lease policy are reused; its patch-id carry is unsuitable here because
the newly rebased tree must be tested.

CI packs nine shares and reserves the producer's T1 runner time. Four
suites run on that producer, with separate results, telemetry and browser
scratch. Ordinary failures and interruption remain nonzero. The suite
receipts retain their existing qualification names and source identity.
Timings, quarantine and report-only soaks run from the exact source SHA
in a read-only workflow_run follow-up, outside main's verdict.

Real-Git controls fail first and pass for local landing, red refusal,
race revalidation and pin provenance. The batch interruption control
fails first and passes after preserving cancellation as failure. The
workflow shape control fails before flattening and passes afterward.
Measured pre-change main run 44012729334 (66e4edb140): 2158 s overall;
share 1 took 881 runner seconds; T1 waited up to 548 s a second time.
Post-change readings and the one-day verdict remain observations,
not estimated success claims.

The review's three MUSTs are repaired: pin provenance uses the exact
single-ref gate predicate; interrupted T1 proofs drain owned process
groups and write failed receipts while report-only policy stays
nonblocking; runner changes reset qualification. Thirteen native controls
and 94 focused cases pass. A planted red during a concurrent main move
stops immediately; only an actual FF rejection retries. Interrupting a
full gate stops its owned push before publication. Lint, types, CSS and
actionlint pass. Full local integration checks still run before main.
