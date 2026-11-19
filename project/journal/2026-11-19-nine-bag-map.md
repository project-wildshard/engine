# QA 15. Draw the platforms in Nine's Bag map

The staging atlas uses Nine rev 3's author image. Its background is
transparent and its geometry covers about six percent of the cell.
Drawing the same product also missed the upper platforms because the
rasterizer discarded world triangles above 60 m.

The map now includes elevated world tiles. The atlas uses that drawing
when it covers more of the cell than a sparse authored image. The exact
staging Nine product went from 1.58% to 15.74% raster coverage, and the
rebuilt 25-tile atlas is 308,312 bytes. Far Reach kept its authored map.

The atlas filename is content-addressed. The corrected Nine tile needs
the next staging app build. The immutable v0.1.52 capture still shows the
original tile.
