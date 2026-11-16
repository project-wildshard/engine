# Zone entry, opus-gcm15 (ZONE-ENTRY-PLAN, meta)

- **ZE7c, the grey Pastel and Ink-Cel props.** Both shards draw their props with the `rock` graph as the props family. The
  family variant (`declaredProps.ts` `acquireVariant`) switched three's `vertexColors` on because the template's GLBs carry
  colours, so `color_fragment` multiplied the graph's pink-to-peach (Pastel) and paper (Ink-Cel) by the measure grey 0.246.
  A graph reads the mesh's colour itself (`vertexColour`, `wsVertexColour()`), so a compiled graph now records whether it
  reads it (`GraphShaderMaterial.readsVertexColour`) and a family variant of one that does not keeps `vertexColors` off.
  Graphs that read it (Nine's facade, the open plots' paving) keep today's multiply: on the family path they are multiplied
  twice (the graph's own read and three's), which is a look change to make on purpose, not here.
- **ZE6, the worker road's walls.** A dedicated worker's road (`openRoad`, `placeOnRoad`) now lays the page's zone walls round every
  cell (`addSeatZoneWalls`: edge line, buffer sides, the gate 10 m in, an entry socket floor in each buffer) in place of the 2 m
  `addCellWalls` round other workers' cells. One road world holds every seat and seats have different homes, so each seat's motor
  passes its own home's wall colliders (`openHomeFor`, the motor's `phased` handles; the worker stamps `home` on the seat entry when it
  hands a seat from a cell onto its road), and the road's trigger crosses a seat only into that home. Walking into another cell from
  the road is gone (GC15 (3)'s between-worker walk, GC30b's walk into Far Reach, a walk into a placed cell): the walker reaches the
  buffer and is held at the gate; those tests now say so. Through an entryway the home's own walls never bite (its crossing fires 6 m
  in, the gate stands at 10), so the filter's red test is the mechanism one in `grid-zone-server-road.test.ts`.

- **ZE14 (offline), in progress.** Offline, a gate to a cell this device never downloaded reads "Not downloaded" and its 0 does
  nothing (`spawnHeld` in `spawnDownload.ts`: the cell's grid manifest and every file it lists are in a cache; `session.ts`
  `gateReason`/`gateOpen`). Preview online reads the far files of each cell its far ring leaves out (`keepRoadSet`), so an offline
  visit whose camera stood elsewhere finds them: Sunscar's offline deck entry asked for Sky Harbor's collision and failed before.
  `scripts/zone-offline-proof.mjs` proves both gates on a loopback build. Left: the in-page solo server reads every cell's whole
  product offline and ~1,800 of those page reads fail (Nalati's too), though the entry reaches control.
