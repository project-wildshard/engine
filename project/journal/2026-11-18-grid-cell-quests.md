# Quests in a grid data cell

> Written by: Claude (opus-gp123, SHARD-SOURCE SS-GP1), 2026-11-18

A grid data cell installed its talks but none of its quests, so a talk
on the cell's server could start a quest the grid page never tracked: no
chip, no pins, no card. A one-shard page builds a `QuestState` and its
presentation per declared quest in `client.ts`.

That loop is now one function, `shardfile/declaredQuests.ts`, called by
`client.ts` and by `grid/dataCellQuests.ts`. On the grid each stay gets a
flag book that follows the cell server's flags (`wirePage.book`, dropped
with the stay, and seeded at once when the cell's world has settled so a
re-entry reads no finished step as news), and the page's context bound
to the stay (`grid/stayContext.ts`: its systems, HUD and Bag end with the
stay, its system ids carry the cell). The chip shows only while the wire
is this cell's. liveSession's per-stay installs for this and the next
rows share one `enterDataStay` helper instead of another enter/leave pair.
