# Keep native inventory refusal evidence

Q135 had one inherited cleanup refusal after 6,081 other cases passed.
The generic inventory error discarded the row that failed validation.
Pine's original detached-writer case passed in 4.40 s; 500 real numeric
inventories passed in 8.00 s. Its 30 s process-churn probe checked another
1,316 inventories with no invalid rows. Q135 is not reproduced, and none
of these observations establishes a scheduling or parser root cause.

Adopt Pine's reviewed narrow diagnostic as the single source forward.
Keep the first refused row's parsed fields and JSON-encoded raw line,
capped at 160 characters. The validation predicate is identical. Every
malformed inventory still rejects; nothing is skipped or retried. Keep
the 500 ms process command and 5 s drain bounds and owned-process rules.

The actual helper already disposes the profile only after a successful
inventory and writer drain. Its descendant-writer test's unconditional
finally removed the failed profile anyway. Keep that profile on refusal
while still terminating only the test's known owned PIDs; print its path.

The new real subprocess control supplies a malformed numeric inventory
through its own ps executable, verifies fail-closed refusal, bounded row
evidence and no profile disposal, then cleans only its verified fixture.
The original writer case plus this control pass in 5.56 s. An actual
old-helper/forward comparison keeps both profiles and refuses both inputs;
only the forward retains the 160-character row. Eligible test typed lint
and fixture syntax pass. No quarantine, deadline or policy is changed.

The one-shot review found that the control's outer process timeout could
orphan its detached child. Its signal handlers now stop and await only
that owned child. A real spawn timeout verifies the exit marker and that
the child no longer exists. The final complete file passes 7/7 in
18.68 s; the added timeout control remains under 10 s on its own.

This is diagnostic coverage and evidence retention, not a claimed flake
repair or qualification streak. Pine retains the FL ledger and original
full-gate red. The next real malformed row must establish the root cause.
