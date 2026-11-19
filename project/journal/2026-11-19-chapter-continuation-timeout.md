# Give each native chapter proof its own deadline

> Written by: Codex (codex-tc48)
>
> **State:** fixed 2026-11-19. CI run 44542508555, tests (4).

The Nalati continuation case failed after 30,063 ms on `6204b0f5`.
The test report charged 33,727 ms to the file. Local profiling found
time spread across native room builds and restores. The same native
case passed locally on `43edd477` with the pinned Nalati revision 3.

Split the case between exact continuation and silent imports plus
historical conversion. Each case gets the original 30-second deadline.
Share the admitted product input and give each case its own worlds.
The second case recreates the same checkpoint through the original
steps and disposes its seed world before restoring it.

All original assertions are retained, including 65 matched ticks,
duplicate-fact checks, snapshot equality, invalid restore atomicity,
historical outbox conversion, rejoining, and adapter retirement.
Both cases passed locally at 3.34 and 3.10 seconds. The second case also
passed in isolation.
