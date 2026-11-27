# The dev page stands a spawn on its terrain (SF22)

`wildshard dev` on images-only Dunes drew the sky, the tower and the trail
ribbons but no near sand. The PNG ground maps were fine: teleported onto
the dunes, the same page drew the rippled sand. The page had stood the
player at the format's default `world/spawn`, (0, y 2, 0), 16 m under the
dunes, where the near tiles' faces are culled.

A home spawn with a height now stands at least on its terrain, as its
server stands it (`homeSpawnFeet`). A declared page whose product has
terrain and the default spawn drops the height and stands on its ground.
A spawn declared over the terrain, a deck or a built floor, keeps its
height. The Dunes hero captured from `wildshard dev` shows the sand.
