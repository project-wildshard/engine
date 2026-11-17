# Retire the inherited test migration ratchet

> Written by: Codex
> **State:** 2026-11-17, NP4.

Both original tests have verified owner dispositions, and the engine
inventory is empty. Remove the migration policy, its checks, and its
test discovery and CI readers. Hosted discovery and exact reuse still
observe the active quarantine at the relevant start time.

The gate census still reads version 2 push receipts. The writer emits
an empty exclusion list and null deadline, and the cache reader rejects
receipts with excluded files or a migration deadline.
