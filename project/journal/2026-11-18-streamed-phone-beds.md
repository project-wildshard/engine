# Streamed phone ambience

> State: measured 2026-11-18 for MEMORY-GATES MG11.
> Written by: Codex

Phone ambience banks keep long recordings encoded until a voice starts.
A whole-file loop can feed the existing ambience bus through a media
element. Authored subranges use the score player's bounded AAC windows
to retain the loop's sample timing. Each live voice borrows the same
recording bytes and owns its decoder and two seconds of queued windows.
Short hums and unsupported recordings keep their native PCM path.
One-shot banks use the existing packed PCM representation.

In live WebKit, Nalati streamed eleven bed recordings and Driftwood
streamed two, including the shared underwater bed. The audio ledger
after an actual unlock read 53.08 → 26.50 MB for Nalati, 27.28 →
22.95 MB for Driftwood and 0.85 MB in both Template builds. A separate
whole-file fixture produced a signal through MediaElementAudioSourceNode
without decoding the full recording.

The spectrum witness compared the same SHA-256 input files at the
same gain, starting 0.4 s before each authored loop seam. Full-rate
Driftwood island and underwater windows matched the old PCM output to
three decimal places in dB. Nalati's prior 24 kHz bandwidth is retained
on the 48 kHz schedule. The wind and river RMS changed by 0.003 and
0.007 dB, and the largest band differences were 0.71 dB at 10–12 kHz,
where the baseline was 34 dB below total power.

Five alternating cold WebKit minimal pairs per zone used engine
`4b61ceca` with identical product pins. The projection uses
`c3776b0d` and `a10d5f36`'s one-sided 90% prediction bound.

| Zone | Median PCM peak [L] MB | Median PCM settled [L] MB | Playing upper MB | Loading upper MB |
| --- | ---: | ---: | ---: | ---: |
| Nalati | 95.02 → 32.44 | 48.62 → 12.71 | 1,148 → 1,128 | 1,584 → 1,524 |
| Driftwood | 31.48 → 25.52 | 17.70 → 12.90 | 1,147 → 1,146 | 1,423 → 1,444 |
| Template | 0 → 0 | 0 → 0 | 663 → 670 | 934 → 974 |

Nalati's median WebContent loading peak fell from 1,119 to 1,068 MB.
Driftwood and Template remain below the loading limit. Their loading
medians were 1,207 → 1,238 MB and 809 → 814 MB, respectively.
Template has no recorded audio. One higher cold trial widened its
loading bound.

The paired samples, recorded spectra and live voice checks are in
the mini cache under `memory-gates/j410-streamed-audio-2026-11-18/`.
