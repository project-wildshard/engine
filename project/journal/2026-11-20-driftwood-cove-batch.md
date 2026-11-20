# Driftwood Cove batching trial

> **State:** Opt-in trial, 2026-11-20.
> Written by: Codex

DF10 tries a shared view draw in Driftwood's baked Cove at phone Low.
Set the `debug.bakedPropBatch` device slot to `"cove"` to run it. The batch reuses the
static prop merge, including its spatial cells. Its source meshes continue
to own their shadows, Explorer picks and collider registrations. High
graphics switches back to the original view draws.

The current Driftwood product has three merged Cove caster families.
The two palm families have independent LODs and stay with those draws.
Cliff and coconuts share one view draw in the trial. Drift is in a separate
merge cell. At the dock the two cold Chromium pairs measured p95 draws
of 82 to 82 and 83 to 82. The five-leg route moved 87 to 86 draws p95,
against DF10's target of 60. Both route arms ran at 60 fps. Render submit
p95 went from 2.3 to 2.6 ms and the source geometry stays resident beside
the merge. Phone Low keeps the slot off by default.

The blind Opus review passed all nine phone-Low poses after a dock
retake with the exact same camera transform on both sides. The board
and route evidence are in meta `project/evidence/driftwood-fps/`.
