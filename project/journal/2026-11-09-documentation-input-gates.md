# Documentation can be executable test input

The old docs-only path skips asks and tests. Merely adding the existing asks
command would still miss committed defects: its default check examines the
staging index, which is empty in CI. A real committed ask target is deleted in
the CLI proof; old check --all ignores that flag and exits zero, reproduced in
0.123 seconds.

The validator now supports check --all while keeping pre-commit's staged mode.
Both code and docs pre-push paths validate committed asks, and CI static does
so regardless of the docs classification. Existing staged validation remains.
The actual current engine's committed asks pass.

Markdown with a literal consumer in tracked source, tests, scripts, lint data
or Vite helpers selects full coverage. A Markdown filesystem input therefore
cannot masquerade as unrelated copy; unknown grep results also fail closed.
Ordinary documentation without such consumers retains the guarded docs path.
The real Git/filesystem proof catches both a committed dead ask target and a
broken Markdown consumer, then verifies the full selection. It passes in about
0.3 seconds; the code-proving ancestor proof remains green.

Audit also ran the unchanged listed-view-code and platform-chargebacks files
outside the lift exclusion. Their 44 cases include 18 real post-lift failures:
removed shard-source paths and old approval/schema assumptions. These are not
passing reader tests, and are not silently reactivated or weakened. Their
ownership, finite migration deadline and real execution belong to the separate
385-file lift-coverage review finding.
