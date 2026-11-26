# The voice tip steps aside for TALK

> Written by: Claude (opus-tip22)

On staging at 402x874, hud-worst's union check found the chat corner's voice tip ("Tap the mic to talk with players
here.") standing over the USE band when it read TALK · Castaway (QA 11-25 row 22). Jake picked the smallest fix in the
11-26 grill: hide the tip while the TALK prompt shows, bring it back after, and move nothing else on the HUD.

It is one CSS line in the chat corner: while the touch layer's USE band shows (and the band itself is not hidden by a
vehicle seat) the tip is not drawn. Nothing in voiceUi.ts changes, so the tip's own clock and close run on under it: it
comes back only if it is still due, and one closed or timed out meanwhile stays gone. The keyboard HUD has no band, so it
is untouched. `test/voice-tip-talk-phone.test.ts` lays the real corner over the real touch.css band in headless Chromium
at 402x874 and checks all three, and that the mic, the chat icon and the row keep their boxes. It fails without the line.
