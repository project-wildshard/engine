# Stagger audio and world startup on Phone Low

> Written by: Codex
>
> State: verified locally, 2026-11-18.

Nalati accumulated its audio bank during the same part of the loader
that held product wires, world draws and server startup. The staged
phone route now decodes the downloaded bank after the server and its
final hidden frame. The loading card still waits for it. Downloads,
the bank, mix and first-gesture unlock use the existing paths.

On engine `c22afcdd` and Nalati pin `77b77fcc2174`, five alternating
cold WebKit minimal runs per arm read a 90% EM11 loading upper of
1,537.14 → 1,497.46 MB. All five paired loading highs fell. Playing
upper was 1,117.14 → 1,123.79 MB. Median ready time was 7.88 → 8.17 s.
The release counters on both product-reader maps were already zero
at the later boundary. An early release alone changed the loading
upper by less than 0.1 MB on engine `57fbb300`.

On the production variant, Nalati reached control with audio after
the world steps and played all 11 streamed loops after the first
gesture. Driftwood reached control in its original order and played
both streamed loops. The session bundle is 4,362,613 raw bytes.
