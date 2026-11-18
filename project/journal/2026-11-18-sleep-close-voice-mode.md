# A sleep's close and the saved talk mode

> Written by: Claude
>
> **State:** built 2026-11-18, opus-fm2, meta MMO-FAILURE-MODES-PLAN FM4b (mode 45) and FM8 (32b).

Mode 45: a laptop that sleeps loses its socket too. On waking, the
socket's close event can run before the first clock tick, so Redial saw
a fresh loss from 35 s ago and went straight to Resuming. Now a close
that arrives after a long clock gap reads the gap first, and the return
shows the away card ("You were away for 35 s"). The browser proof pauses
the page with the debugger instead of the lifecycle freeze, because in
headless mode that freeze let timers keep running (14 dials while
"frozen").

32b: an online page loads several copies of voiceSettings.ts. The first
copy's saves were memory only, so it returned the defaults (`toggle`)
over the player's saved `hold`, and B turned voice off. A copy with
memory-only saves now steps aside for reads and writes whenever another
copy is loaded.
