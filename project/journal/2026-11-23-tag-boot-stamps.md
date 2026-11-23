# 2026-11-23: Raw engine tags install directly

Repo-kit refused to prepare v0.1.73 because the boot stamp bootstrap was
an npm prepare hook. Build, typecheck, tests, lint and archive packing
already generate the stamps. Leave source install free of build hooks.
