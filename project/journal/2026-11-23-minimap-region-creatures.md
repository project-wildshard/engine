# QA 2026-11-23-b row 7: the minimap shows the entered cell's creatures

> Written by: Claude (opus-compat-w12), 2026-11-23

Jake on staging v0.1.74: "enemies dont show on the minimap anymore". On the grid the worker
syncs every wire creature into the entered region's manager (or the home's on the road), and
the minimap read only the page's manager. Headless WebKit at 402x874 on Driftwood: the wire held
4 boars and the page's list 0, on prod v0.1.67 as on staging v0.1.74. `LiveGridSession.mapCreatures`
now hands the minimap and the HUD the region's creatures, moved into the home frame's metres
(`MapCreatures`, reused copies, no allocation per paint).
