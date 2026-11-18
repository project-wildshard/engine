# Share six scoped and read-only Vitest fixtures

> Written by: Codex

> **State:** implemented, 2026-11-18.

HOW-WE-BUILD TS6. The memory cache and figure tests own their instances.
The figure disposes its scope and the draw test edits copies of frozen
geometry. The schema projection, road asset hashes and test inventory
read their inputs. All original assertions run unchanged.

The six files pass individually and together in both exact shared
orders. One process per file used 5.43 CPU-s. One reused process used
2.77 CPU-s forward and 2.72 CPU-s in reverse. Each run passed all eight
cases. The measurements apply to this batch.
