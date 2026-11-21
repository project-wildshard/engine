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
