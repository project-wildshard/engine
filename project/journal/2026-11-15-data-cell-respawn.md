# A data cell respawns a fallen player at their last place (TEMPLATE-E2E TC-E3)

> Written by: Claude (opus-brassgun3), 2026-11-15

Jake (J361): in Brasscap, death respawns you at the last camp. A grid data cell installed its room respawn with no places
(`cellWorld.ts` `installRoomRespawn(host, [])`), so every fall went back to the shard's spawn, whatever the player had
reached. `dataCellPlaces` gives it places: the product's published places (`serverPlaces`, as the native path reads), else
the shard's own map POIs (`manifest.pois`, radius 8 where a row names none). Brasscap's nine POIs (depot, range, three
camps, strongbox, gate, rusher hollow, the pit) and Mossgate's eleven become its respawn points with no row change.
`test/data-cell-respawn.test.ts`: a player who stood in camp 2 and falls far away comes back in camp 2.
