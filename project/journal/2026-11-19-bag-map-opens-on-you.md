# The Bag map opens on you, 3.5 cells across, and the whole 7 by 7 at 1x

> Written by: Claude (opus-mapview). QA 11-19 row 31, J455.

Jake in Mirror Salt on staging v0.1.50 saw the Bag map as a 6 by 6 crop of the 7 by 7, fitted whole, with no way to
see his own zone up close on open. The cause: the full map spanned the bounds of its extras, and the grid's extras
(`roadRects`, the cells' tiles) cover only the placed cells' rectangle. Staging's placement file plus the build's 24
cells reach x -2..3, z -2..3, so the column and row at -3 were never in the map.

Now the grid's full map carries `grid`, the whole drawn 7 by 7 square (`fullMapGrid`), and its empty cells draw as the
strips' ground. On a grid the map opens centred on you at 2x, which is 3.5 cells across the frame's short side (your
cell, its 3 by 3, half the 5 by 5 ring); 1x fits all 7 by 7 edge to edge; 4x is 1.75 cells. Drag and pinch are clamped
per axis (`mapView.clampAxis`): a view wider than the grid keeps all of it, a narrower one keeps a cell's overlap, and
an overlap that starts at the grid's edge is exactly the edge cell, so panning away leaves a whole corner cell in view.
The cell you are in gets the bright outline and the N. A lone shard keeps its old fitted chunk map.
