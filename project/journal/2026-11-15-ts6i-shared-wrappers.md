# Share owned subprocess wrappers

> Written by: Codex

> **State:** built locally, 2026-11-15; HOW-WE-BUILD TS6i.

Four existing Node suites now share the worker: agent-time, commit-lane,
ci-bisect and player-command-retired. All four pass independently and in
exact forward/reverse shared orders, with their assertions and deadlines
unchanged.

The first three run maintained Python controls in fresh, synchronously
reaped children. Their mutations are confined to those child interpreters
and owned temporary directories, which their context managers remove.
Commit attribution and replay receive the exact candidate source bytes;
the log report uses private input files and scoped dependency patches.
The last suite only reads the tracked tree with `git grep`. None installs
state, mocks a module, stubs globals, changes the parent's environment or
relies on an uncached Node import.

One worker, unchanged production setup and aliases, full child-process CPU
via RUSAGE_CHILDREN: warm isolated 4.002 CPU-s; shared forward/reverse
3.793/3.278 CPU-s. Cold isolation is 4.029 CPU-s. The observed local change
is small and variable (5–18%); no full-gate saving is claimed. Exact
measurements and the source audit live in meta `docs/plans/vitest-bench/`.

The separate earlier quest/rekey/rig candidate remains isolated: although
all ten cases and its scope-balance control pass, neither shared order
improves on warm isolation. TS6's broader startup work and TS12's exact
full-gate census remain open.
