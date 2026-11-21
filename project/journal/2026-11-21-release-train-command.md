# Run the engine train through npm next

The v0.1.62 and v0.1.63 trains proved that the signed staging alias can
start npm next while J451 runs. The operator had to copy a driver for
each new version and track the exact CI run, staging serial and npm run
by hand.

Engine scripts/release.sh now drives the same release-branch, staging
and trusted publish commands from one version and notes file. It uses
the candidate verdict, the public signed serial and the release CI run
as admission. It keeps the archive and registry checks for the exact
build and records the run ID before watching the publish. An interrupted
delivery can continue from the existing branch and candidate evidence.

The train also permits a newer cut when an earlier staging release was
abandoned. The existing signed staging ancestry check owns that decision,
and the train's local lock prevents simultaneous operator runs.

M8 cut A's first local run exposed the macOS Unix socket length limit.
The local rig now uses a short owned scratch path. The verdict continues
to validate the full source SHA before it can qualify a cut.
