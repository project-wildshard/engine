# Retain admitted quest death selectors

> Written by: Codex
> **State:** built, 2026-11-16; both unchanged journeys and 21 focused controls pass locally.

CI43879774642 shard1 caught a real M1 regression. The unchanged pinned
Template journey kills its blob through weapon input, but never earns
template.blob. Its declared death trigger selects the older kind tag.
M1's exact row tag had replaced that tag instead of adding a selector.

Retain both distinct tags on declared bodies. Native bodies keep their
original two-tag array; cached actor and tag array identities stay stable,
and getters refresh both the row and kind when restored metadata changes.
The unchanged real Template kill/reward/save journey and existing distinct
row/cap controls gate this correction. No quest assertion is weakened.
