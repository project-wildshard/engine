# J193 time-boxed quarantine

Jake explicitly authorizes non-blocking execution for engine-rule-successors,
net-fuzz, browser-escape and pine-rewards in both ci and ring-1. The committed
test/quarantine.json is the authoritative list: codex-pinefix2 owns each
entry, with its exact UTC deadline 48 hours after list creation.

The selector refuses malformed policy and automatically returns expired
entries to the blocking cohort. The runner retains ordinary test failures
and their exit code, prints owner/deadline metadata, writes original JSON
results and appends a job summary. The workflow's explicit continue-on-error,
not an altered assertion or swallowed exit, supplies the approved waiver.
These four files still execute, using full products and one outer worker;
Ring 1's smaller inventory cannot run every one of these files.

The shared workflow/config owner integrates blocking selection and separate
non-blocking jobs. Local full pre-push retains the complete test inventory.
The deadline and list are tested directly before the full normal push.

Whole-tree lint exposed style errors in the first runner draft. Corrected
them without disabling rules; whole-tree lint and typecheck now pass. Both
workflow files also pass actionlint. The shared cohort integration is
committed as 1633a1f, separate from the blocking covered-verdict summary.

Exact a7ed8e0 CI 42475678403 reproduced one additional 10-second timeout:
pinned-restore-play's saved Nalati real walk. The other 5,770 blocking
cases passed. J193 explicitly authorizes the same quarantine for another
file that times out. Add that file, still owned by codex-pinefix2, until
2026-11-10T11:57:31Z, exactly 48 hours from this follow-up. It executes in
both non-blocking jobs; no assertion, saved fixture, runtime or clock is
changed. The local full gate continues to include all five files.

The first hosted CI4 matrix on a52f646, run 42478017721, exposes three
more file-clock overruns against the new 60-second file budget. Their
assertions pass: cook-worker 111595 ms (shard 2, job 128723775452), Nalati
population 101959 ms (shard 3, job 128723775494), Driftwood population
102584 ms (shard 4, job 128723775407). J193's additional-timeout policy
keeps these running and reporting in both quarantine jobs, owned by
codex-pinefix2 until 2026-11-10T12:04:31Z. These are file-budget overruns,
not claims of failed gameplay assertions. No file clock or assertion is
raised or weakened. Local full checks still include them.

Exact f0a8a0c run 42479173262 passed assertions but found four further
60-second file overruns: Nalati bot taming 69632 ms (job 128727310351),
discovery 72816 ms (128727310386), Driftwood long session 75238 ms
(128727310364), Nalati taming 89597 ms (128727310411). The last shard
subsequently hit its five-minute whole-job deadline before completing;
that job is not claimed green. Add only these observed over-budget files
under J193, still executed and reported, owned by codex-pinefix2 until
2026-11-10T12:20:11Z. No measurement threshold or gameplay assertion is
changed. Their file-clock failures remain explicit in the quarantine
reason rather than being mislabeled as failed simulation assertions.
