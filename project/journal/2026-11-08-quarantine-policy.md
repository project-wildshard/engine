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
