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
