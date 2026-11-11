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

J206 Codex review (three MUSTs): per-checkout blocks still lose updates under
concurrent installs, a union of blocks can hide an authored file at a mount path
in another checkout, and an unterminated block could swallow a live one. Git has
no per-worktree exclude file, so the design is now simpler: only the canonical
checkout writes the block; a linked worktree never touches the shared file. Same
pins are covered already; an extra path a plan publishes shows as untracked in
that worktree only, which `land` and `worktree new` ignore (tracked-only checks).
CRLF and a missing end marker no longer swallow lines.
Clocks re-recorded for the reworked test.
(The rework itself landed in the commit after this paragraph's.)
