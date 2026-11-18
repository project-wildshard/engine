# The ledger guard confirms an over-line zone before failing it

memory-ledger-guard reddened main three times in two hours, each time
on a single hosted reading: Clockwork's control loading at 25.8 to
26.1 MB, Coral Drift at 34.0 MB, and Ink Cel at 18.2 MB on the v0.1.42
branch (latest run 44296562868). The same builds read 22.6 MB, 30.8 MB
and 14.0 MB on other boots. Control "loading" depends on how many ring
tiles happen to be resident when the boot reaches control, so one
hosted boot swings 3 to 4 MB. The guard compared each zone on exactly
one boot, so a 2% line flapped on noise and blocked green-main release
selection.

The Coordinator asked for the guard to be fixed, not the baselines.
The guard still reads each zone once. When that reading is over the
line, `memory/ci.mjs` logs the failure and measures the zone a second
time. `ratchet.mjs` now judges hosted ledger zones with
`confirmLedger`: the zone passes when any reading is inside the line
and fails only when every reading is over, listing each reading's
failures. A real retained allocation shows in every boot, so it still
fails; the planted 20 MB test buffer still goes through
`compareLedger` directly. The baselines and the 2% line are unchanged,
and the native WebKit ledger keeps its own multi-run comparison.

Retrying once costs one extra boot only for a zone that is over, so a
green run costs nothing extra. Median of three would have tripled every
run.
