# The chat corner on a keyboard: bottom left, like a phone

Jake, 2026-11-10 ~23:15 Cancún, after the QA 6 shots: "You want to fix the
position of chat and microphones in desktop mode too." Lane opus-voice2,
meta `docs/plans/QA-FEEDBACK-2026-11-10.md` row 47.

A14 and QA 42/43 moved the corner over MOVE on a touch screen only. A
keyboard page (`pointer: fine`, any width) still put it top left at
`safe-top + 92px`; in a narrow window the mic sat on the quest chip. Now
every page anchors it bottom left. A keyboard page has no stick, so it sits
over the coins (`#hud > .ws-loot-chip`, bottom 92 px, 28 px tall): 132 px up.
It goes higher while a steed's row shows (same spot as the coins, about 50
px tall) and, on a desktop, while the Developer alert stands at the left
(perf.css puts it at bottom 130 px; 210 px clears a few lines of it). The
open chat grows up from the same corner. Touch keeps its own rule and now
says `bottom: auto`, so phones are unchanged (measured: same boxes before
and after).

Proof: a real local online world (`online-rig.mjs`) at 1440x900, a 402x874
keyboard window and a 402x874 phone, before and after; `hud-worst.mjs
--check` on the after build.
