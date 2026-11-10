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

Q140's first normal publication was refused after 6,084 passing cases:
net-fuzz's Nalati hostile-client case hit 10 s, and the original native
writer case reported Command failed: ps. The latter is an exec refusal,
not the malformed-row refusal; the old callback discarded its useful
structured fields. The log does not establish whether its unchanged
500 ms limit fired or another native exit occurred. No root cause is
claimed and that failed capture is not a green publication.

Retain the command's code, signal, killed flag and elapsed milliseconds,
plus at most 160 characters each of its message, stdout and stderr.
Keep the original refusal and every existing bound. An actual owned
sleeping ps executable is terminated by the same 500 ms exec timeout;
the control verifies SIGTERM/killed facts, bounded output, no disposal
and its original marker. Do not infer that controlled cause for Q140.
The test prints the failed writer profile path, but the queue's failed
snapshot was later absent; no retained directory or actor is claimed.
The old-helper/forward exec comparison is red/green on these facts;
both reject and preserve the profile. The final native file passes 7/7
in 18.41 s and eligible typed lint is green. The new one-shot read-only
review reports no MUST/SHOULD findings (Claude quota fallback to Codex).

Q144 supplied the first concrete exec refusal fields: SIGTERM/killed at
1,029 ms with machine load 43.1. Its configured timeout is 500 ms, not
one second; elapsed includes callback scheduling. A direct real ps plus
a controlled 650 ms parent JS stall reproduces success with empty stdout.
The same happens with the cheap kernel tool through async execFile.
Node's timeout destroys unread pipes after a completed command when its
JS callback is delayed. This establishes a real empty-inventory mechanism;
it does not prove the exact unobserved Q135 row or every Q144 delay.

Collect the table synchronously with the unchanged 500 ms native timeout,
before returning to JS, so that delayed JS cannot discard completed pipe
data. Clip each collection to the remaining original five-second drain
and check elapsed time again before admitting completion. A blocked
worker beyond five seconds still refuses, retains the profile and stops
its owned child. Malformed output still meets the identical guard.

On Darwin, use a small source-built KERN_PROC_ALL snapshot rather than
ps's per-process decoration. Keep all positive user PIDs, parents, groups
and zombie states, including detached descendants; this is not a group-
only query. Linux retains ps. In 24 alternating local pairs, about 1,124
rows: ps median 29.7 ms / max 38.7 ms; kernel snapshot median 5.3 ms /
steady max 15.2 ms. Its first native load was 214 ms. Compilation and
first native loader execution belong to the existing resource-preparation
phase, before startup/drain clocks. No executable or capture enters Git.

The old cleanup refuses a real detached writer when its ps executable
actually runs past 500 ms; the forward kernel collector drains that same
writer before disposal. The new real JS-delivery control checks both
650 ms recovery and refusal after 5.1 s, including retained profile and
confirmed owned-child termination. The one-shot review's MUST adds the
module type declaration; its SHOULD adds this deadline-negative control.
No quarantine, scan/drain/startup deadline or oracle has been relaxed.
The final native file is 8/8 green in 23.88 s, including the real trusted
Escape pair, detached writer, malformed/timeout controls and both JS
stall outcomes. Eligible typed lint and native compiler warnings pass.
