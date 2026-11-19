# B3 after the bridge's forced frames (NET-LAG NL17)

> Written by: Claude (opus-netlag14), 2026-11-19

Driftwood missed B3 on staging in every run of NL17's matrix (128 to 172 ms) while the loopback rig passed. The
proof now keeps a delay and jitter series per phase, and one staging run on v0.1.50 shows why: the wire's jitter is 2
to 6 ms the whole run, except while B4 forces 60 ms frames on the rope bridge, when the held page thread stamps
frames 120 to 134 ms late and the delay climbs to 175 ms. It is back at 70 ms 11 s after the bridge. That is the
proof's own stall, not the link, so `b3Verdict` (scripts/net-lag-verdict.mjs) gives the forced frames the same 10 s
to settle that entry gets. The bar (120 ms, held 0) is unchanged. NL4's Driftwood command with no bridge, same
release: B3 80 ms, B2 0 a minute.

The same holds for B2 on the phone: B4's injected 1 m sink settled into the walk's first seconds, 3 corrections a phone
run at 30 fps on v0.1.49 and v0.1.50, none with no bridge. B2's window now opens once the correction count has held still
for 2 s after the bridge (at most 10 s). Staging v0.1.50, Driftwood phone Chromium with the bridge, two rounds: B2 0 a
minute, B3 82 and 83 ms.

NL16's second branch: headless WebKit's frame pacing (no vsync snap, whole-ms stamps; an idle page reads p99 19 to 29 ms)
cannot meet B1's p99 and 2x lines whatever the game does, so `b1Verdict` judges WebKit on the 50 ms line only and reports
the other two with the reason. They are read on the iOS Simulator stand-in (NL11, J423). Chromium keeps every line.

The boost's way back is now bounded by the ground the walk and sprint covered (`boostBack`). In Nalati the sprint stuck
after 3 m, so 60% of a 20 s boost went 75 m past the spawn, out of cell 4 into cell 0, where the page died on another
cell's creature. With the bound, staging v0.1.50: both layouts stay in cell 4 with no frame over 50 ms.
