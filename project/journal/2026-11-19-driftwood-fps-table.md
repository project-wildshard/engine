# Driftwood's five-profile FPS table

> Written by: Codex
>
> **State:** DF6 tooling, J464/J465/J467, 2026-11-19.

Run `node scripts/fps/table.mjs --zone driftwood-isle --base <grid-origin>` on the mini.
The phone profiles draw at 402×812. The desktop profiles exercise 1496×717 at DPR 2
and 1920×1080 at DPR 1. Desktop-native measures the shipped desktop tier and the
phone Low preset at each of those desktop rasters. Only the desktop profiles on
this benchmark launch Chromium with its frame-rate limits removed.

Each cold capture opens a fresh context and starts the route at the control-ready event.
The final warm repeat keeps that context's caches. The report stamps the served build and
witnesses the game's own build and renderer DPR. A shared measurement lock and browser
lane cover each capture pair. The worker refuses an overlapping headless GPU process
and closes its page if the Jake-playing marker appears. Each capture is capped at four
minutes including entry. Verdicts come from DF2's drawn-frame samples.

With all nine profile/size/graphics cases, three cold repetitions alone take 90 minutes
of fixed 200-second routes. A dock diagnostic can print all five rows in one short pass.
A qualifying profile needs DF3's phone CPU factor. DF5 still owns the measured phone
GPU multiplier.
