# Match Pine revision 6 audio and released save

> Written by: Codex
>
> **State:** fixed 2026-11-19. Engine CI 44560975372, tests (4) and (8).

Pin `fdb2ae99` brings Pine 6 and its newly encoded shared piano stems.
The engine manifest still named revision 5's two mounts, leaving the
piano slot unresolved in the audio report and download cook. Use the
two names in the verified r6 archive and regenerate the audio and
version stamps with all 26 pins admitted.

The original released save (`df724459`) resumed and walked on the full
`86c0ecc5` product and its Ring 1 slice. Buddy-engine landed that target
in `a6323220` during proof. `542ba93a` covers the boot trace failure in
the same CI run.
