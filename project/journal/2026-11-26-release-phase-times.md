# Release phase times and a 180 s budget

Fix-preview PV19, opus-pvpage. Jake: release step under 3 min, the job under 4 min. page-release.mjs
times each phase it runs (build, upload, check, go-live), prints `phase <name> <s> s` lines and a total,
appends a table to `$GITHUB_STEP_SUMMARY` when the runner sets it (preview.yml's job summary), and prints
a `::warning` over 180 s (J295: amber, a fix row the same day, never a red). The table prints on a failed
run too. Guard: test/phase-times.test.ts.
