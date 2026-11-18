# The Template footprint guard confirms a batch before it fails

Main run 44311995731 on 0f741196 passed the ledger guard. The Pine red
was ad52cc05, which I reverted. The native WebKit footprint guard then
failed for the first time in five runs: Template's settled WebContent
median of five boots was 594.0 MB against a 590.6 MB line (baseline
539.4 MB plus a 51.2 MB spread).

That median is already noisy across runs on the hosted macOS runner.
On passing runs between 09:58 and 12:07 it read 588.8, 588.5, 564.5,
588.7, 577.2 and 566.6 MB, so the line sits about 2 MB above the
highest of them. This run's five boots spread from 539 to 600 MB. The
only commit since the last pass that touches WebKit memory, 66f3f506,
changes Nine's slab grid, which Template doesn't use.

So the footprint guard now follows the same rule as the ledger guard,
for the same reason. When a batch's median is over the line,
`memory/ci.mjs` measures a second batch of five. `confirmFootprint` in
`ratchet.mjs` judges each batch on its own median and fails only when
every batch is over. The baseline, the spread, and record mode (which
pools every reading) are unchanged.
