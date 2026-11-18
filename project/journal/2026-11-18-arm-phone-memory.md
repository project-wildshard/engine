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
playing and 1,447,250,243 B loading. The full qualification passed all
26 armed pins across 130 measured boots. Far Reach had the highest
playing and loading readings among the 22 light zones at 769,277,797
and 1,050,698,788 B. The preview's grid has no cell for Desert Ruin or
Thin Ice, so their five-run standalone playing and loading readings
were 594,716,039 and 851,164,947 B for Desert Ruin, and 578,591,866 and
787,308,423 B for Thin Ice. The existing Ubuntu ledger uses standalone
Chromium. The raw native readings and computed table are in the lane's
`j426-2026-11-18/pinned-native` receipt directory.

The first hosted hard qualification on `4026d299` passed all 25
armed Ubuntu ledger comparisons. Its macOS 15 native job refused
Nalati's 1,043,634,221 B playing reading. Loading was 1,229,520,942 B.
Five locked boots of the exact same pin and engine build on the mini
read 986,803,116 B playing and 1,317,890,545 B loading. Hosted settled
medians were 786.55 MB WebContent and 319.05 MB GPU. The mini read
601.30 MB WebContent and 424.81 MB GPU.

EM11 was fitted on macOS 27. The native job now targets GitHub's
macOS 27 image through its `xcode-27` label and records the OS build.
It keeps the same model, limits and five cold boots per zone. The job
has 90 minutes for the 130-boot sweep. The hosted Ubuntu job stays on
the original instrument and comparator.
[First hosted qualification](https://github.com/project-wildshard/engine/actions/runs/44375696856).
[GitHub macOS 27 image](https://github.blog/changelog/2026-10-15-xcode-27-runner-image-generally-available/).

A fresh six-boot mini check on `4026d299` read the same pinned Pine
product at 993,357,493 B playing and 1,468,262,375 B loading. The
STR8 sweep observed 1.010 and 1.541 GB on this pin, so its margin
remains narrow. QA29 tracks the prepared Pine product's release and
production re-pin.
