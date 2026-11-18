# Enforce the shared phone memory policy in engine CI

> Written by: Codex
>
> **State** · qualified against the full pinned client and the covering Ubuntu artifact, 2026-11-18.

J426 takes zone membership and the phone lines from shard-format's
published memory policy. Engine CI uses an exact development alias
of that package. The committed subsystem readings still supply the
Ubuntu ceilings with the measured two percent allowance. Any armed
overage or missing reading fails the job, including when recording.
Unarmed readings are advisory.

The two guard jobs use the same full pinned preview and grid as the
Ubuntu ledger. The existing Nine native subsystem ledger still uses the smaller
benchmark preview that established its ceilings. The official online
meter reads that zone's phone footprint from the full pinned preview.
Combining the new zones with the trimmed benchmark grid exceeded
the existing grid-strip wire budget. The full pinned preview builds
within that budget.

In covering Ubuntu CI run `44352071998` on engine `ca7b0293`, the
first boots for Driftwood, Nalati and Pine reached control and passed
every subsystem comparison. In a later covering run, `44363083599`,
all 26 Chromium zones passed on their first boot with the same ceilings.
Brasscap r7 read 44,513,696 B at control and peak. The r6 first boot
had reached 47,694,200 B at the server checkpoint on an extra
1,215,972 B of array buffers. The r7 reading clears the existing
47,407,792 B peak ceiling.

Loading subsystem readings and ceilings are in bytes.

| Zone | Control | Control ceiling | Peak | Peak ceiling |
| --- | ---: | ---: | ---: | ---: |
| Driftwood r4 | 54,007,758 | 72,850,860 | 70,804,837 | 118,321,187 |
| Nalati r2 | 89,954,347 | 91,652,029 | 115,264,728 | 143,857,464 |
| Pine r5 | 127,151,812 | 129,694,848 | 181,034,414 | 196,777,113 |

Five cold, shared-lock native WebKit Phone Low boots per zone used the
full client on `ca7b0293`, the minimal instrument and the STR1 online
meter. The loopback world uses the matching server inputs, and each
reading verifies that the page started no standalone server worker.
The EM11 upper playing and loading ceilings are 1,000,000,000 and
1,500,000,000 B.

| Zone | Upper playing [K, EM11] | Upper loading [K, EM11] |
| --- | ---: | ---: |
| Driftwood r4 | 877,706,634 | 1,194,494,138 |
| Nalati r2 | 932,177,300 | 1,314,649,423 |
| Pine r5 | 952,219,279 | 1,350,555,577 |
| Nine | 970,665,744 | 1,492,641,354 |

Nine passed all three native standalone ledger runs in the covering
hosted artifact. Its loading peaks were 120,245,465, 148,047,873 and
135,371,069 B. Nine uses that instrument because hosted Ubuntu
SwiftShader could not reach its control checkpoint.

The separate five-run Pine rig replay also passed with 972,417,596 B
playing and 1,447,250,243 B loading. Placed zones use online JSON. Desert Ruin and Thin Ice have hidden
placements outside the world grid, so their enforced readings use
the supported standalone boot. The selector reads the preview's
actual grid. The existing Ubuntu ledger keeps its standalone
Chromium instrument.
