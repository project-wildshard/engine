> Written by: Codex
> State: implemented, 2026-11-17.

Mini QA73/F46: a staging proof read the page shell and saw no quests or
creatures. scripts/proof-state.mjs now owns the browser observation. It
reads shared and player flags plus quest progress from the worker client,
live creature positions by requested kind, and the authoritative seat's
one-based index into the page grid. Road and unknown seats stay explicit.
The dev worker report remains usable without its dev-only net reader;
ordinary local probe fields remain intact.

The reader serializes directly into page.evaluate without imports or
closed-over values. Three failing-first regressions cover an empty MMO
shell, the dev fallback, local quests, title, road and unknown seats in a
fresh VM realm. Spawn and MMO grid proofs use it; the SDK guide documents
its installed-package import and requested creature kinds.

Follow-up: a scoped probe remains on window after its level retires. Check
its world before invoking state; the added case failed with "Debug level
has retired", then passed with the guard. Title/exit reads return null.
