# Full-test lease observations

DS3 needs the occupied time and queue wait of every actual full-test owner,
including direct release/tag checks outside the push queue. Previously a real
isolated lease finished without creating any full-test log; the actual-command
control failed on the missing file.

The machine scheduler now appends request/acquire/release events beside its
existing build log. All checkouts and linked worktrees use that same scheduler
root. UUID lease IDs and machine names survive transfer, so the read-only report
can merge copied logs or bounded SSH reads without double counting. A machine
that cannot be read, malformed rows, conflicting duplicates and incomplete
leases are named rather than counted as zero occupied time or a successful run.

Events record the holder, command label, repository/worktree/plan, load, queue
and held seconds, child CPU and real exit code. Inline programs and credential
arguments are redacted. Durations use monotonic time. Nested inherited commands
do not invent another acquisition. Nothing reads these observations to admit a
command, reuse a test proof, alter a cap, or determine whether checks passed.
An unsafe/unwritable log prints a warning and preserves the command's verdict.

Manual outer-edge proof: `python3 scripts/full-test-log-proof.py` runs eleven
actual tiny commands with isolated flock state, including FIFO contention,
admission timeout, exit7, command timeout124 and SIGTERM130. Two real linked Git
worktrees append to one log. The actual report deduplicates a transferred copy,
names damaged/missing inputs and preserves a red command when a symlink refuses
the log write. This passed in 3.35 seconds. It is outside the test gate and
launches no browser or full suite.

The J206 one-shot review is
`engine-dev-speed-ds3-20261110T171108Z-88734.md`. Both MUSTs reproduced on
actual paths: Authorization text survived the first redactor, and a FIFO
`.git/HEAD` blocked a real wrapper before admission. Whole-value/attached-eval
redaction and bounded nonblocking regular-file metadata reads fix them. Metadata
unavailability is recorded without losing the lease event. The report similarly
refuses special files and invalid UTF-8, validates grouping fields, and excludes
an entire conflicting lease from totals independent of input order. Original
report code fails the new real CLI control on a FIFO; current code passes.

Release checks now carry an explicit report-only argument through the existing
delegation to the lease. It affects no environment fingerprint, selection or
admission. With this argument removed, the actual release fallback is classified
manual and fails the new outer-edge assertion. Restored, the actual helper/tag
and deleted-producer control passes in 8.16 seconds with exact CI retained and
the actual uncached engine fallback recorded as release. Existing five scheduler
tests also pass in 2.45 seconds. There is no new report-authorized test reuse.

`python3 scripts/full-test-report.py` reads the local default log. Add repeatable
`--log PATH` inputs for transfers and `--remote TAILSCALE_HOST` for the same log
on an operator-configured second machine. Remote reads are noninteractive and
bounded; an unreachable mini remains explicitly unavailable. No second-machine
availability, 24-hour coverage, occupancy saving or whole DS3 completion is
claimed by this source change. Those require the live observations in the plan.
