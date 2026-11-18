# Bound decoded ambience on phones

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

Phone cue catalogue beds decode at 24 kHz with their original channel
count. Both the eager and lazy catalogue paths keep their authored
loop bounds, fades and gains. A compressed recording shared with a
one-shot or hum retains its existing decoding policy in the eager
bank. Desktop, music stems and the AAC window cache retain their
existing paths. The rate reduces bed bandwidth to 12 kHz on phones.

Five alternating cold WebKit pairs used the same Nalati product and
engine runtime at `08f3d688`, phone Low, a 402 × 874 viewport and DPR 3.
The settled sample used two collections and a five-read median.
The phone projections use the committed EM11 model at `72e30a23`.

| Metric | Before, median MB | After, median MB |
| --- | ---: | ---: |
| Nalati decoded bed recordings [L] | 46.100 | 23.060 |
| WebContent settled [K] | 939.66 | 925.12 |
| GPU process settled [K] | 613.99 | 614.19 |
| WebContent peak [K] | 1,270.60 | 1,218.22 |
| GPU process peak [K] | 792.02 | 791.05 |
| EM11 phone playing, central (upper) | 1,139 (1,251) | 1,127 (1,242) |
| EM11 phone loading, central (upper) | 1,530 (1,665) | 1,475 (1,622) |

Four of five pairs lower each central estimate. Their peak ranges
overlap. The buffer saving is identical in every paired run. The
loading and playing upper bounds remain above their target.

Focused audio tests passed 37/37. The tests verify that the full
decode and the stereo 24 kHz bed cache can share the same compressed
bytes without replacing each other's PCM, and that the loop keeps
the same duration. Full typecheck passed. The production session
closure measured 4,355,761 raw and 1,344,985 gzip bytes.
