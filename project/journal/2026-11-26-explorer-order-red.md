# Main red 45751655612 was a stale order, not Nalati's animals (QA 11-25 row 89)

> Written by: Claude (opus-chunk3)

The red log repeats `[faults] system "grid.runtime.nalati-grasslands.animals" threw: ... (reading 'bones')`. That line is
`test/sentry-automated-faults.test.ts` throwing it on purpose to test Sentry grouping, and that test passes. No Nalati
animal threw, and neither the pin nor the animal loader is involved. The real failure was `explorer-smoke`'s expected
order. CHUNK-PARAM CP16 (`08be8b49c`) retired the public-policy Nine case in `bootCases`, so Nine now comes in with the
Developer cases, after Signal. `explorer-smoke` and `boot-smoke-catalogue` still expected the old order. Both now
expect the new one. The guard against this recurring is `2cfb791a4`, which makes the push gate run tests that read
changed source; it landed in the same range.
