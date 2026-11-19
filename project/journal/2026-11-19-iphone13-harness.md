# Run the iPhone 13 harness from engine

> Written by: Codex
>
> **State:** code and recording replay, 2026-11-19. IP2, IP3 and IP5 device qualification is queued.

Port the working Safari path from meta's phone_boot.py and reuse the
iphone13-m1 draft's doctor, lock order, readers, routes and reports.
Navigate a fresh automation tab to the game's origin before resetting
and reading back saves. Safari's own HTTP cache may carry. The device
screenshot goes through devicectl, outside the measured page.

The bench records separate boot, walk, soak, deck and allocation
staircase attempts. It preserves a failed card or last stage across
session loss, pulls relevant Jetsam records and reads back surviving
slots before the next reset. Sysmon tracks the selected PID and gives
loading peak, control and settled reads. Activity Monitor and other
xctrace templates keep their trace and exported tables for comparison.
The IP26 release suite uses the same entry point.

Replay Nine reaching control on staging 071d1699 and Pine's tab loss on
7c31da66 with only build, zone and stage fields in the fixture. The
recordings have no paired sysmon or Activity Monitor samples. The phone
lane owns that proof, the LAN and reload checks and the lock contention
run. No device commands were run for this change.
