# NB2: page and seat agree; the hold is 5 minutes

> Written by: Claude (opus-compat-w2, meta SHARD-COMPAT NB2, 2026-11-21)

A one-shard page now asks the door for its own shard on every dial (`?chunk=<slug>`, GO7's goto).
A fresh title pick of Driftwood while the seat is held in Dunes moves the seat (the held body leaves
saved) instead of sending the page to Dunes; a door that doesn't host the shard seats it as before
and the page still follows (duneRay's fix stays for older doors). `HOLD_MS` is 300 s (was J114's
30 s), so a reconnect at 4 minutes lands where it left and at 6 minutes the seat is gone. The
redial's own give-up clock stays 120 s: after it, a fresh page comes back into the held seat.

Left for the row: the staging proof on phone and desktop, and the held-seat cost measured.
