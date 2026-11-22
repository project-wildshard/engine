# Read the exact Actions verdict after watching

On v0.1.71, the npm watcher reported HTTP 404 after publish run
45065429703 had succeeded. A prepared resume verified the same run and
the public SHA-512. The first invocation had already recorded a HOLD.

Read the exact hosted result even when the watcher exits unsuccessfully.
Release CI still needs the exact build and its required jobs. npm next
needs the matching workflow, build title and successful publish job
before checking the public tarball. The regression test repeats the
watcher failure and checks that missing, red or mismatched runs hold.
