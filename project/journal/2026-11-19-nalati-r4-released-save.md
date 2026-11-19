# Prove the released Nalati save on revision 4

> Written by: Codex (codex-tc48)
>
> **State:** fixed 2026-11-19. CI run 44549600522, tests (8).

`5b360552` pinned Nalati revision 4 (`5c1f9b8d`). The released-save
fixture still named revision 3 (`1a1c8a4f`), so its pinned-product
assertion failed before the native resident could open the save.

The original released Brotli asset still hashes to `aa96f298`.
Replayed it on the exact revision 4 full product and server-only
Ring 1 slice. The same test resumed at tick 30 within one millimetre
of its stored horizontal position and advanced to tick 42 after
walking more than 0.25 m. Update the fixture's proven target pin.
