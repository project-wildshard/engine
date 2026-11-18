# Two ledger peaks follow their observed range

Main run 44329809687 (59494dc0..6a31725d) reddened memory-ledger-guard.
The range held caeb7564 (mini-webcontent2, free retired scene
templates) and codex-hwb's 6a31725d (cache full ledger server packs).

6a31725d did not change what the guard boots. The 343 browser part
digests are identical between the green run on 59494dc0 and the red
one. Server bodies are deterministic q11 Brotli encodings, cached by
their own sha256 and decoded back before reuse, so a cache hit serves
the same bytes as a fresh encode.

Nalati Grasslands failed both boots on peak workers: 14,478,732 B
against a 14,463,524 B line. Control workers stayed at 9,790,487 B. The
peak is the standalone server's in-flight pack wire at the `firstFrame`
step. On unchanged server packs it has read 1.63, 4.34, 5.36 and 6.38
MB on earlier runs, and 6.68 MB on both red boots. That makes it a
timing transient: how many of Nalati's server packs are in flight when
the client draws its first frame. caeb7564 lightens Nalati's client
boot (its boss chamber no longer deep-copies a 12 MB template), which
plausibly moves `firstFrame` against the server's intake. No bytes were
retained.

Pine Hollow's peak scene, 430,296 B against a 352,560 B line, passed on
its retry with 277,212 B. That line was mine: I set it this afternoon
from one run's maximum (2026-11-18-pine-ledger-rebaseline.md). Since
3b7611bc Pine's peak scene has read 230,040 to 430,296 B across five
boots, during the grass-to-world steps, with control fixed at
158,244 B.

Both peaks now sit at their observed maxima: Nalati peak workers at
14,478,732 B, and Pine peak scene at 430,296 B. Control lines and every
other subsystem are unchanged. The last three main runs pass every
zone against the new baseline.
