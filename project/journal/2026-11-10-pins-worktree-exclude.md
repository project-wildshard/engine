# pins in a plan worktree no longer rewrites the parent's exclude

codex-port, 2026-11-10: a `pins.ts install --from-format` inside a J240 plan
worktree broke the canonical checkout's pins. Git's `info/exclude` lives in
the common dir, so DS6's `--git-path` fix still pointed every worktree at the
same file, and the install replaced the parent's block of published mounts
with its own one-slug list.

`scripts/pins-exclude.mjs` gives each checkout its own block: the canonical
checkout keeps the old markers, a worktree's markers name it, a write
replaces only the writer's block and drops blocks of worktrees that no
longer exist. Patterns are root-anchored, so the union only hides published
mount paths. The real-Git test fails on a single shared block (the parent's
mounts show as `?? public/`).

Clocks for `test/tooling/pins-exclude.test.mjs` recorded with `push-preflight.mjs timings`.
