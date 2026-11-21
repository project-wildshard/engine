# FS30 isolate the live-frame proofs

Production nightly 44872093835 completed both test partitions and the
Pine and Driftwood cooks. Their Chromium gameplay PNGs returned in
325 ms and 360 ms, but the browser pixel read outlasted the capture
window. Both draw witnesses hit the 90-second ceiling after the
ordinary gameplay and hover checks had already spent live frames.
Driftwood's second tap also ran out of its 5-second actionability wait.

Read the same composited PNG on the host. Start the 30 completed draw
samples as soon as gameplay is ready, before the other proofs consume
that window. Give the real hover tap the nightly slow-runner ceiling so
Playwright can see a stable button across frames. The pixel threshold,
sample count and post-tap mount and unmount assertions still apply.
