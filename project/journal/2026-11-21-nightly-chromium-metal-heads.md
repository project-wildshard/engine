# FS30 Chromium Nine and Nalati

Nightly 44883760299 ran these heads on SwiftShader. Nine presented
one more frame during the 90-second hover attempt, with the actual
button present but never actionable. Its draw check hit 90 seconds
and world-watch reported a gap. Nalati reached play, missed the
shared boot deadline and never entered the hover phase. It passed
that same Chromium proof in 44877247860 with 30 draws in 89 seconds.

Both pinned heads passed boot and real hover on local Chromium
ANGLE Metal. Each provided 30 draws in about a second. Keep all of
their existing Chromium checks in a dedicated macOS runner group
with the same limits. The Linux diagnostic entry point retains
SwiftShader for reproducing the software-rendering behavior.
