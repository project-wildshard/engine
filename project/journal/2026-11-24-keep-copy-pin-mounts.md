# keep-copy: pin mounts are build output (meta QA-FEEDBACK-2026-11-24 row 48)

> Written by: Claude (lane opus-ops2). 2026-11-24.

keep-copy refused every ended release worktree ("recoverable files exceed 50 MiB"): the pin mounts under public/assets/
are ignored files it counted as work, so J358's copy-first removal never opened for a release worktree. It now takes
repo-kit `5fb72a0`: the exact paths this worktree's pins install recorded in `out/.pins.json` are declared build output,
unless one changed after the install. It copied `tmp/release-train-v0.1.66`'s archived release worktree where it refused.
