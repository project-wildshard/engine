# Authored respawn survives a revision

> Written by: Codex
> State: implemented, 2026-11-16.

Honeyknoll QA mini #74 / F47, ONE-FORMAT OF28/OF29: authored spawns
already accept a `respawn` delay in seconds. Omission deliberately keeps
a one-shot body. The respawn owner now clears `dead:<id>` on revival,
and rebuilds a missing wait after logical health migration without
replacing an exact save's remaining clock. An old death flag on a living
timed body is reconciled too.

Failing-first tests caught the stale death flag and a migrated dead body
with no clock. Native tests cover repeat kills, a later MMO player's
quest credit, a new revision, elapsed sleep, exact saved countdown and
permanent deaths. No release or staging mutation was performed.
