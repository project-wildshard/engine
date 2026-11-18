# The warm body's road variants

> Written by: Claude
>
> **State** · landed, 2026-11-18 (NET-LAG NL15, opus-netlag7).

NET-LAG's 283 ms boost frame on Driftwood was not the hoverboard. A
traced staging run (v0.1.45) logged each new program with its key: at
the road, z 250, the other-player warm body's held sword linked its
opaque program with no environment, 289 to 427 ms of one Chromium
frame. Its key differed from the cell's only in envMap.

The warm body fills its hand a slot a frame after the kit is lent,
after the boot's road-variant warm-up has taken its inventory. Once
the hand is full, the body now asks `Game.warmExteriorRoots` for its
road variants, paced in play like a cell's.
