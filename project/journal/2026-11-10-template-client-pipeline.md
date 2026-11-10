# Share the existing app pipeline with the client comparison

J233 requires three measured client options, including a warm Rolldown
watcher. The normal CLI now calls explicit prepareAppBuild and
finishAppBuild functions. They contain the existing ordered steps and
both require the ordinary build lease. Importing the module starts no
build. No validator, size gate, native mode check, service worker, epoch
check, part cook or publication step is removed or cached by this slice.

An actual build with the original CLI body and another with the extracted
pipeline ran against the same current source and Template catalogue,
with a fixed local comparison build ID. Each emitted 2,479 regular files.
All 2,478 non-version files have identical SHA-256, including client code,
maps, parts, the service worker, standalone shells and Doctor output.
Only version.json differs: its two real build timestamps advance; every
identity field, including epoch 1 and renderer revision, is identical.
The original warm build took 10.04 seconds and the extracted one 11.70.
Those are individual observations, not a speedup or five-edit result.

The one-shot review found no MUST-FIX and one SHOULD-FIX: inherited
process.exit calls prevented an in-process caller from cleaning up after
a refused step. The API now propagates AppBuildFailureError; the CLI
preserves the original child exit code. The actual original preparation
body exits 7 before finally. The forward catches that same real child
exit and runs finally, while the normal CLI still exits 7. This admitted
outside-hook control takes 728 ms and retains every admission guard.
The final control, after formatting, takes 577 ms. Fresh before/after
output directories also repeat the 2,479-file comparison after this
failure fix: 2,478 exact files, with only the real version timestamp
different. Full per-file hashes and both source hashes are retained in
the local comparison JSON, not inferred from successful exit codes.

The earlier cold no-tsc baseline was 24.77 seconds. A headless Metal page
then used the actual Developer switch, Shard Select, Template card and
Enter World to reach blender-template/play with three drawn frames in
2.56 seconds. No title arrival, save, event or game state was seeded.
Two earlier preview startups exceeded the fixture's unchanged five-second
bound with no output; an import diagnostic later measured module loading
at 11 ms. Their cause is unproven and their red records remain retained.

This is preparation for comparing the three clients. No watcher or dev
server is installed in hooks, no winner is selected, no 60-second smoke
is claimed and no plan row is marked done. The current production and
staging publication checkout use their committed source independently.
