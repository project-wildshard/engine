# Memory ratchet qualification

> Written by: Codex
> State: qualification code, 2026-11-17 (ENGINE-MEMORY EM35 and EM36)

The ledger checks each subsystem at control and against its own loading
high-water mark. The observed batch can lower the next checked file.
The check refuses anything over the committed bytes plus 2%. The raw
capacity counters stay separate from phone predictions.

The local Template control charged 17.53 MB to loading. The Chromium
negative control held and touched a 20 MB backing store at renderer
startup. It charged 51.65 MB to loading at control and exceeded its
17.88 MB limit. A separate unplanted run reached 43.25 MB at peak versus
a two-run calibration of 37.98 MB, so this ruler needs a hosted spread
check before activation.

The WebKit check uses the median settled WebContent of five cold boots
and the positive spread observed on the same hosted macOS image. Each
job emits its proposed ratchet and raw readings. The CI input
`memory_record` records both files from the current production pins.
The jobs compare against the files when they are committed. This keeps
measurement host and browser settings tied to the CI workload.

Hosted macOS 15 qualification read 618.04–666.05 MB after control
across five native WebKit boots. The settled median was 646.96 MB.
The committed positive spread is 19.09 MB. A regular production CI
run loads this file and fails above its 666.05 MB ceiling.
[Qualification job](https://github.com/project-wildshard/engine/actions/runs/44233634711/job/134565599126).

The extended recording reached Nine after 20 successful Chromium
boots across six zones. The first Nine boot timed out waiting for
control at 180 seconds. The hosted ledger now gives Nine the existing
480-second memory-probe deadline. Other zones keep 180 seconds.
[First extended run](https://github.com/project-wildshard/engine/actions/runs/44239650390/job/134585981330).

The 480-second retry also stopped before Nine reached control.
Ubuntu now measures 26 pinned zones. macOS measures Nine with its
native WebKit ledger and stores that baseline separately. Both
comparators use the same subsystem map and 2% tolerance. The
standalone Ubuntu smoke reached control in 134.137 seconds under
its own fixture. The explicit qualification also runs a separate
bounded microscope diagnostic and keeps the last observed checkpoint.
[480-second run](https://github.com/project-wildshard/engine/actions/runs/44246104563).

The diagnostic captured the checkpoint sequence through props to gap.
It now exits successfully after recording a readiness timeout with
a checkpoint. Regular measurements still fail on that timeout. The
26-zone qualification also retries a failed install once and reuses the
full production pin cache after a socket closed during the first attempt.
[Split qualification](https://github.com/project-wildshard/engine/actions/runs/44255220814).

The Ubuntu-only replay reached control on all 80 boots. The serialized
CDP dump queue missed the control ledger on three Open Plot runs.
The microscope now keeps a real page-recorded control checkpoint
when its process dump is absent. It leaves that checkpoint's process
list empty. A qualification can rerecord selected known Ubuntu zones
with Template and both controls. Ordinary comparison still requires
the entire committed coverage.

The committed Ubuntu baseline uses 80 cold boots over 26 current
pins. Twenty-two zones come from the 753e3162 sweep. The 8428cd67
refill covers Template, Brasscap revision 6, Ember Forge and Jungle
Ziggurat. The independent clean Template passed. The planted run
reported 51.62 MB of loading storage at control against 35.10 MB
allowed. The Native WebKit baseline uses three inspector-free Nine
boots on 8428cd67. The Template footprint ceiling is now 590.63 MB
from the first hosted minimal run. The next batch passed at 581.33 MB.
Production jobs now require the files.
[Ubuntu sweep](https://github.com/project-wildshard/engine/actions/runs/44255220814/attempts/2).
[Refill and controls](https://github.com/project-wildshard/engine/actions/runs/44268975659).

In the first regular comparison, Driftwood stopped at props with
the game's 61-second no-progress card. The ledger job had been
requesting detailed native-process dumps even for counters already
recorded in the page. Ledger-only now reads those checkpoints after
boot, and keeps the error card and last checkpoint on failures.
Explicit microscopes and the Nine diagnostic keep their dumps.
The comparison still requires real control for all 26 zones.
[First regular run](https://github.com/project-wildshard/engine/actions/runs/44276449981).

The release merge d514e2ae reached control in every Ubuntu zone, then
Clockwork Canyon, Ember Forge, Fossil Badlands and Saltwind Lighthouse
crossed the loading caps. Clockwork's full 2.97 MB increase was in
ArrayBuffers. Across eight alternating local SwiftShader boots on the
same Clockwork pin, 19e00075 and its audio-streaming child 577cf8cb both
read 16.52 MB at control and peak. After two collections both read
16.38 MB. Audio peak fell from 28.20 to 24.85 MB. The WebKit pass split
landed later and does not run on the Ubuntu Chromium path.

A complete direct-checkpoint recording on b786cd2b supplied 80 cold
boots covering the same 26 exact pins. Clockwork recorded 22.620,
25.981 and 22.618 MB of loading storage at control. Captured loading
peaks account for 23 of the 28 differences against the old limits,
including the retained ArrayBuffers seen in Far Reach and Pine Hollow.
The remaining five entries are worker accounting. In Ink Cel Valley
and Pastel Plain, the server physics row measured 792,588 B at control
instead of 528,392 B. Nalati's highest worker reading held more wire
bytes at firstFrame.

The new file uses the recorded high-water values. The independent
clean Template passed and the 20 MB planted buffer tripped control
at 51.65 MB against 34.85 MB allowed, and tripped the peak as well.
Both Chromium and native WebKit still compare their subsystem budgets
with the same 2% cap.
[Release-merge comparison](https://github.com/project-wildshard/engine/actions/runs/44277584673).
[Direct sampler qualification](https://github.com/project-wildshard/engine/actions/runs/44284828105).
