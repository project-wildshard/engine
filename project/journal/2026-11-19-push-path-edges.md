# FS27. The push gate runs the readers 11-19's reds had no edge to

Jake, about 21:05 Cancún: "we are really like flipping that thing red a lot".
Most of the day's main reds came from pushes whose gate never ran the file that
broke. The causes were:

- **Vitest only follows imports.** Its related selection walks the import graph.
  A test that reads a pin, a digest, a CSS file or a source by path has no
  import edge to it.
- **A pin push sends its tests to hosted CI.** It is a harness change, so the
  split gate keeps only the native files local.
- **check-css never ran at push.** It was only in CI static. The ws-drive
  classes in d835998f6 went red there.

`scripts/push-path-edges.mjs` now declares those readers:

- **Every code push** runs check-css (under a second) and the three host-ruler
  table tests.
- **A path in `PATH_EDGES`** runs the tests that read it. The paths are:
  - shard pin → pin-shard and racked-prompt;
  - format section → host-ruler-roots;
  - precompile.ts → precompile-first-view;
  - loading card → inline-shell-css;
  - the chrome-keychain and gate-related-tests scripts → their own tests.

  check:saves and check:inline-shell-css already run on every push, and the
  table names them so the test holds them there.
- **A pin or digest push** runs `ring-step.ts --only` for just the Ring 1
  slugs it moves. One slug takes about 4 s; all seven take 17 s.

The readers join the split gate's local Vitest run. They do not start a
second Vitest. A related non-split push gets a separate reader task.

`test/push-path-edges.test.ts` holds one push per mapping and fails if the
plan leaves out its run. It also fails if a new edge has no push case, or if
a mapped file is gone.

The Coordinator did not assign the rest of the FS27 row, so it is not done
here: re-recording the traces and main-watch's first-red view.
