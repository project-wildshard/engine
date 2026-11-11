# Main red after the Settings land: a chunk named after the checkout

Main ci 43064007268 (`ccdbd181..eb9d9db4`, the SETTINGS SR11-SR13 land) went
red in tests (1): the build carries production's kept graphs from
wildshard-singleplayer.vercel.app and refused with "Immutable deploy chunk
changed size: b/c/late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js".

Cause: rolldown names a shared chunk that no group claims after the
modules' common folder, which is the checkout's own name: `engine` in CI,
a worktree's slug locally, `engine-source` in the singleplayer shell. Its
importers list it in `__vite__mapDeps`, which Vite writes after their hash
is taken, so one importer hash held different bytes per checkout. The
Settings change moved modules into that chunk, so the training dummy
started importing it, and the same name now had 2029 bytes in the shell
and 2022 in CI.

Fix: that chunk is always named `shared` (`controlChunkFileName`), so
importers carry the same bytes in every checkout; and a kept graph that
collides with a path this build writes is dropped whole with a warning
naming the path, instead of failing the build. Against the live shell the
build now drops its two newest graphs (each names a chunk this build
rewrote) and carries the older ones: 709 files.

Also in that run (non-blocking, J186): cook-to-play builds in a `git
archive` tree under tmp/, where `git rev-parse` names the outer checkout,
so `source-input-proof.mjs` refused ("Source-program checkout root
differs"). The build now gets HEAD's own file list, as build-mirror does.

Guard (coordinator): skipping a clashing kept graph is right for old
builds nobody serves, never for the build live right now if it is ours:
open tabs on it lazy-load those chunks. On a clash the carry reads the
origin's (or directory's) version.json; if the clashing graph is that live
build and its commit is in this repository, the build fails naming the
file and the deploy. The live shell build (`e156857`, the singleplayer
repository's, which J210 retires and SHELL-CUTOVER SC1 replaces) is
dropped with a warning that says so. Tested both ways.
