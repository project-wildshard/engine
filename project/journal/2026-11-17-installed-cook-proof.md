> Written by: Codex
> State: proved, 2026-11-17.

Mini QA41's worker hook was already fixed by 6495cfcb. Its small regression
laid out an installed module manually and flushed invalid bytes; the
remaining requirement was a complete cook from an actual fresh install.

The existing installed-cook CI test now npm-packs this engine, installs
its tarball and declared dependencies into its private tmp project, then
runs a full prepared format-2 cook using a valid generated UASTC master.
It uses the default phone tiers, verifies the phone's encoded file and
desktop's original master, all four manifests and the server index.

A control removes only this disposable installed worker's hook, reproduces
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, then restores the exact bytes
and completes the same full cook. Both installed-cook cases pass locally
in 12.42 seconds. No runtime change or publishing step is needed. The file
already belongs to normal CI, so this boundary runs on every suite.
