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

J206 Codex review, two MUSTs, both fixed. A fixed 210 px lift left a
many-line Developer alert under the chat, so the lift is now measured:
every 500 ms the corner reads what stands at the bottom left (coins, a
steed's row, the health readout, the desktop Developer panel) and sits 10 px
over the highest. And a mouse with Settings' Touch controls on showed the
touch HUD with the chat in the keyboard spot over MOVE: the touch place now
follows the touch HUD itself (`#hud.touch`, or a coarse pointer) through a
`data-touch` mark, not only `@media (pointer: coarse)`. Measured again: the
phone's boxes are the same as before; the forced touch HUD at 1440x900 puts
the chat over MOVE; `hud-worst.mjs --check` passes in Chromium and WebKit.

Second J206 pass, one MUST, fixed: an obstacle counted only if its top was
in the bottom half, so an alert taller than that was skipped. It now counts
by its bottom edge, and the lift is capped so the input row stays on screen.
