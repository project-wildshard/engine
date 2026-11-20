# Index tile refinements by cell

> Written by: Codex

DF13's largest unnamed dock system was the grid's late update.
Cover checks ask the tile streamer to retire a cell's fine tiles on
each drawn frame. Retire by cell and skip cells with no fine tiles.
Maintain the index at reservation and in the common drop path so failed
reads, eviction and disposal still release the same tiles, children
before parents.

Two locked A/B pairs at the same Driftwood r6 dock used a provisional
3× Chromium phone-Low profile. Grid late update mean fell from
0.739 to 0.688 ms and from 0.753 to 0.659 ms. Update p50 went from
5.0 to 4.8 ms and from 5.3 to 4.7 ms. Update p95 went from 6.7 to 7.3 ms
and from 7.8 to 6.9 ms. DF13 still owes the 3.0 ms calibrated route.
