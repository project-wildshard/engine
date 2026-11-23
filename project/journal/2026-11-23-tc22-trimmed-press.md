# TC22: a trimmed press (opus-nightly2)

- Nightly 45158091056, Chromium heads 5: Saltwind's unmount tap was corrected away (hover.json: corrections 0 -> 1,
  board back on). After a stalled page frame sent the HOVER tap, the socket's queued server frames each pulsed held
  commands past `MAX_QUEUED_COMMANDS`; `CommandQueue.trim` dropped the oldest, the tap, which the page had already played.
- Fix: trim drops only the motion; dropped presses ride on the oldest kept command (HOVER toggles, JUMP/DODGE/LOCK once).
  `test/net-hover-stall.test.ts` lost the tap at 30-150 tick stalls (frame before queued messages) before the fix.
