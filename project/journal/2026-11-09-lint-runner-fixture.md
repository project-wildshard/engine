# Exercise the extracted typed lint helper

The canonical full suite found that lint-all's isolated CLI fixture did
not copy lint-tools.mjs after the native-cache extraction. The child
failed module resolution before exercising the runner.

Copy the actual helper alongside the actual runner. Resolve the native
environment from the real pinned tool installation, then pass that
explicit supported override into the isolated runner. Its file list,
single typed-process, worker settings and failure-propagation assertions
stay unchanged. The fixture no longer tries to find a package pin in
its deliberately minimal source-only directory.

The repaired lint runner, latest hook prediction and committed-source
dependency checks pass ten assertions across five active files in
2.79 seconds. Engine's canonical format alias now resolves inside its
own checkout; no root-containment guard was relaxed.
