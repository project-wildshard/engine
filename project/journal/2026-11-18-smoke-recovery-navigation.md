# Old-cache smoke recovery navigation

On staging v0.1.41 (34dc20a3), SM5 K1 and K2 timed out on a tap
just as the title came back. A K1 trace from the retained v0.1.40
profile showed repeated Exit to Main Menu taps during the first
exit's navigation. The trace captured no worker activation or idle
title handover.

Wait for the actionable control or document to change after a
recovery tap. If navigation takes a control away during its tap,
choose the next control from the new document. A tap failure on
the same document still holds the run.

Two Chromium fixtures reproduced both failures before the fix.
The recovery, smoke runner and smoke checks suites passed after it.
