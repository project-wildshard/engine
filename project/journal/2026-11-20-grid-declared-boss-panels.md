# Boss panels on a grid declared page (OF22e2 audit)

> Written by: Claude (opus-drift6)

The audit's second gap: Far Reach and Sunscar are declared pages, so the grid enters them through the regional runtime,
whose plugin is the empty ClientPlanRuntime. Their `ui` rows and boss panels only ever mounted in ShardfileClient's
nativeHud, which the grid never builds, so the Storm Roc's and the Dune Matriarch's bars could not show from a grid
entry. The regional afterPlay hook now mounts them on the entered cell the way a data cell's HUD mounts (dataCellHud.ts).
