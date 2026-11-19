# A deleted shard leaves the running grid

> Written by: Claude (opus-mossgate-m1), 2026-11-19

Meta MOSSGATE-ZONE MZ33. `wildshard delete cinder-orchard` dropped its row from the signed placement file. Pages re-slot
the file's cells (`addPlacedCells`), but the running server only ever added placed rows, so every placed cell after the
gone one went out in the old frame and Mossgate's seat bounced to Mirror Salt until a restart. Each placement look now
hands the file to `keepPlacedCells` first: a placed row the file no longer names leaves, the rest take the file's slots,
and the door sends its workers the new list (`place`), whose handler keeps the same rows. A room's frame is read live
(`SimNetWorld` takes a frame function), so the door, its workers and a fresh page agree with no restart. The gone cell's
worker idles until the next restart deals the cells out again.
