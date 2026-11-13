# 2026-11-12: phone ceilings make room for J299 audio

The v0.1.14 staging build stopped at the shard size gate: Pine, Driftwood, Nalati and Nine Dragon each download a few MB
more on a phone than their latched ceilings. AU1 moved each shard's boot audio into DOWNLOAD (J299), so those bytes were
always fetched, just later; now the gate counts them. Preview had been red on it since d22e6a75. Four raises name J299
and stay under J303's 10 MB audio budget, and the gate takes a J number as a decision. opus-rel14.
