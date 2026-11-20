# Standalone background saves

> Written by: Codex
>
> **State:** 2026-11-20. Driftwood DF8.

The standalone autosave had a long synchronous encode on the simulation
worker. The experimental `debug.backgroundStandaloneSaves` device slot
ships the frozen Rapier bytes to a lazy codec worker and uses the usual
serialization and IndexedDB acknowledgement.

The fixed-tick capture still excludes nearby colliders. A road save also
captures any parked world owed a continuation. Its debt stays open through
the durable acknowledgement, and a newer crossing or eviction can supersede
the saved capture.
