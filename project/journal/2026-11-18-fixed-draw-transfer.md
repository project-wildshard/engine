# Reuse assembled fixed draw templates

> Written by: Codex
>
> **State:** locally qualified, 2026-11-18. ENGINE-MEMORY EM28.

Driftwood held whole-geometry assembler output and a cloned copy of every fixed
draw template across the loading renderer peak. Follow the ownership handoff
into each exclusive template. Requests to copy or borrow a template keep
their original storage semantics. Shared assembly slots still get independent
templates. Each source scope forgets the loan after intake.

The paired cold Chromium Metal snapshots used engine `28f7e96c`, Driftwood
revision 2, and Phone Low at control. The existing backing-store classifier
found 64,360,931 to 50,658,765 bytes of geometry [H]. The live scene's
position/index subset stayed at 22,499,318 bytes. Position-only backing fell
by 7,276,260 bytes, colour by 4,092,624 and normals by 1,101,474. The total
crosses EM28's 60 MB Driftwood target.

Six alternating shared-lock native WebKit Phone Low pairs used minimal
measurement. Settled WebContent fell in all six, from 688.43 to 673.00 MB at
the median [K]. Median loading WebContent fell from 863.37 to 845.14 MB.
Control buffer ledger held at 42.56 MB. EM11 upper playing fell from 988.57
to 987.89 MB and loading from 1,339.57 to 1,327.28 MB.

All nine Phone Low spawn views preserve draw and triangle counts. The board
was sent before landing. The focused fixed-draw suite covers exclusive
handoff, shared source copies, cold readers and failure cleanup.
