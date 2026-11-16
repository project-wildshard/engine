# Template suite qualification

T1E-2d's gate is built; actual hosted evidence remains open. The producer
reads receipt-only Actions artifacts and shares its qualification policy
with all four consumers. Traces have separate artifacts. The collector
checks main/push metadata, source SHA, common build, Linux, actual test
status, wall, complete A content and the current suite's source hash.
Three full pushes and 72 hours after a complete receipt are required.
Changing the suite resets the window. Missing history keeps reporting.
History scans at most 500 artifact headers and probes up to 20 runs near
the three-day boundary and the recent tip, within a one-minute budget.
This is deliberately conservative when history is inconclusive.

Twelve focused qualification, membership and keychain checks pass. A real
three-second entry hold still turns the phone loading assertion red; its
report receipt retains exit 1 rather than claiming pass. The restored
phone suite is rerun after that drill. Current A content is absent, so
no live receipt can yet promote the suite. Neither synthetic dates nor
local Metal results qualify the hosted window.

Final-land review: setup failures now write failed receipts; the workflow's
advisory job policy covers download/install failures until qualification.
A red or incomplete current-suite main receipt resets the report window.
The collector reads every available receipt in that window and its anchor;
incomplete lookups remain advisory. Product sharing follows the existing
shard wall check, so suite setup is not charged to unrelated test shards.
The rebased 15-test browser suite and focused checks passed locally.

Local pre-push validation after the save-lock refusal: the two browser
fixtures only seed existing device keys, so the save inventory classifies
them explicitly. No save definition or lock fingerprint changes.
`check:saves` passes all 3 checks. The actual exported static lane passes
lint, types, format, sides, asks, page events, wire and saves. The split
selection for the remote branch range passes 31 files / 153 tests;
`test:kit` passes 12. The previously rebased 15 browser specs also pass.
