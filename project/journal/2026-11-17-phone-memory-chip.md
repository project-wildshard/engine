# Live phone memory chip

> Written by: Codex
> State: implemented 2026-11-17 (ENGINE-MEMORY EM34)

The Developer grid chip uses the EM11 ledger fit for its headline and
range. The panel shows live ledger capacity, predicted phone bytes and
the target for each EM33 subsystem. The totals use the shared EM11 math.
The browser row takes the 16.5 MB blank WebContent from EM4. The engine
row takes the rest of the fixed fit. The existing allocation drill-down
shows individual storage owners.

The screen uses the 2,048 MiB ActiveHard reported for an iPhone 17 Pro.
The underlying fit retains the two bounds from the measured staging
failure. [Device report](https://developer.apple.com/forums/thread/823061).

[Nine at spawn on phone Low](2026-11-17-nine-phone-memory-chip.png).
Headless Chromium, real Metal, production build. The paired full
session closure held at 4,393,468 raw bytes. The Developer module loads
on demand.
