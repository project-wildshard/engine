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
