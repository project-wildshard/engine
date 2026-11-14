# benchmax names readyFrame's 100 ms stretches (buddy-engine)

- NINE-DRAGON-BENCHMAX NB3, the coordinator's ask: name every step of
  100 ms or more in `readyFrame`. benchmax only reported unlogged
  stretches of 200 ms (the row's done-when); it now reports 100 ms.
- Staging v0.1.19 (`7251ca24`), Nine Dragon, phone viewport, cold:
  x4 readyFrame 2.0 s, x8 3.7 s; unlogged >= 100 ms: none at both.
  Every 100 ms+ stretch is named. Nearly all of it is one span,
  `app:spawn-view-tiles` (1.9 s / 3.7 s): the settle's tile attaches.
- The cut is the next step and not a quick fix: the attaches already
  write a per-tile, per-content `wildshard.tile.attach` measure under the
  loader (DL21), which says which content holds the span. Logs in
  `~/.cache/wildshard/plan-artifacts/nine-benchmax/nb3/`.
