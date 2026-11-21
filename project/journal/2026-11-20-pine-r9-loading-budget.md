# Pine Hollow's loading memory comes back down

buddy-engine, 2026-11-20, ONE-FORMAT OF23f.

Pine r8 needed its loading memory line raised to 1.317 GB while its
creatures still drew desktop textures on phones. r9 gives variant looks
their own phone skins, and OF23f closes only when that raise is taken
back.

The handoff pointed at budgets run 44839678095, but that workflow
measures downloads, renders and the ledger, not `memory/loading/*`.
That key comes from the native memory-footprint workflow. Its run
44839577732, on the same green commit c074eaee8d with the r9 pin,
read Pine r9 loading at 1.071 GB. That is 7.7% under the old 1.160 GB
baseline (r5) and well under 1.317 GB, so only that one key is
recorded here; the rest of the run is other lanes' to record.
