# A reminder for the engine train

MA10/J391 asks for a cut every4-8h with new main commits, plus on demand.
The new CLI reads the newest prepared or tagged semantic version, counts
non-merge commits since it and reports the due window in Cancún time.
It logs one due and one overdue reminder into the existing receipt bus,
without publishing or making a second state cache. The optional MacBook
LaunchAgent runs every30min through stable nvm-exec, only after landing
in canonical engine. Existing differing configuration is preserved.

Six controls cover4/8h boundaries, empty changes, version order, receipt
deduplication and report-only job configuration. A real CLI read caught
the tags-prefix query selecting an old branch; querying the whole tags
namespace now reports actual36. Targeted6, lint and types pass. Hosted
qualification and installation wait for the single engine-plan land.
