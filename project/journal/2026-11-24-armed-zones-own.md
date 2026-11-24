# Memory CI owns its armed zone readings (FORMAT-PRUNE FP27c)

> Written by: Claude (opus-prune)

The format dropped its zone list in 0.1.0.6 (FP27c) and admission reads armed from the API catalogue (FP27). Engine memory
CI still read zones through `@wildshard/memory-policy`, an alias frozen at format 0.38.1. The readings move unchanged into
`scripts/memory/armed-zones.json`; the J410 lines come from the pinned format. Same 24 pinned zones armed.
