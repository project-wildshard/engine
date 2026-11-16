# Own warning fixture scratch and Git input

> Written by: Codex
> **State:** built locally, 2026-11-15; unpushed and unlanded.

WL12a addresses SHOULD 3–5 from the one-shot land review. Warning and
observer fixtures now use the runner-managed scratch root, with the
standard vitest fallback. Each warning fixture still removes its own
directory in finally.

The advisory accepts an optional Git environment. Every real-Git fixture
passes its cleaned environment through that port; production defaults
stay unchanged. An explicit foreign GIT_DIR/GIT_WORK_TREE input proves
that the fixture's warning still fires, its parent environment stays
identical and its directory is removed.

AGENTS lists the CLI's warning output state. No warning cutoff, refusal,
receipt policy or successful-land behavior changes.
