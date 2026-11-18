# A reminder for the engine train

MA10/J391 asks for a cut every4-8h with new main commits, plus on demand.
The new CLI reads the newest prepared or tagged semantic version, counts
non-merge commits since it and reports the due window in Cancún time.
It logs one due and one overdue reminder into the existing receipt bus,
without publishing or making a second state cache. The optional MacBook
LaunchAgent runs every30min through stable nvm-exec, only after landing
in canonical engine. Existing differing configuration is preserved.

The scheduled check fetches main, release branches and tags because the
MacBook can be idle while the mini pushes. An unreachable origin writes
a stale receipt with the last known main commit. Eight controls cover
the cut window, empty changes, version order, receipts, fresh refs and
the report-only job configuration. The manual CLI picked the prepared
v0.1.39 cut and reported its next window in Cancún.

The live staging proof now reports the epoch from the signed release.
The release and page checks already asserted epoch 2. The summary had
printed epoch 1 after the same checks passed.
