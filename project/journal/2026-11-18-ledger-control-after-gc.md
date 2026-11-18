# The Chromium ledger reads control after a GC

v0.1.45's run 44398174924 failed the armed ledger gate: Nalati control
loading 111,129,455 B against a line of 91,652,029 B. The Coordinator
held the release and listed SB47, the tier-pacing commit, both
memory-gate commits and CC28a as suspects.

None of them caused it. The CI ledger artifacts give Nalati control
loading for every main run:

| Run tip | Control loading (B) | Note |
| --- | ---: | --- |
| 4289c484, 31d16fcb | 89,954,347 / 89,958,419 | canvas 1.6 MB higher then |
| 9f9e2d6a .. 7317b12a, f5fe3733 | 88,381,487 | ±2 KB |
| f61079f8 (v0.1.44 release run) | 88,379,183 | |
| 8cd83a0f (main tip) | 88,381,487 | |
| f06e5d4c (v0.1.45 release run) | 111,129,455 | |

f06e5d4c is 8cd83a0f plus the version bump in `package.json` and
CHANGELOG. The difference is all array buffers: 109,030,715 B against
86,282,747 B. Every run reaches about 109.03 MB of array buffers by the
server step. Every run except f06e5d4c then drops about 22.74 MB, and
the step where that drop lands moves:

- server to audio in most runs;
- readyFrame to spawnPrograms on 4289c484;
- inside a 52.8 MB drop at worldFrame to readyFrame on f61079f8.

In f06e5d4c it never came before control.

The ledger counts an ArrayBuffer through a WeakRef until a GC clears it
(memoryAttribution.ts). `chromiumLedger` read control the moment the
loading card went, with no GC. So the 22.74 MB is garbage that had not
been collected yet: a GC-timing sample, not a code regression. The line
is not mis-set either. The baseline is 89,854,931 B plus 2%, which
leaves about 3.3 MB of headroom over today's 88.38 MB.

The fix: after control, the ledger path calls `page.requestGC()` once
and reads the counters again. That settled ledger becomes the control
checkpoint, and the raw one is kept as `unsettled` on the checkpoint.
Peaks still come from the boot's own checkpoints, which nothing
changes. The planted negative control still adds its 20 MB at read
time, so it still fails.
