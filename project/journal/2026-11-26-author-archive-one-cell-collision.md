# The author archive opens its one-cell world

The shared R2 ship fixture exposed a missing server input before WebKit could record its shaders. The author client
kept the server book for its build, but removed the full catalogue's collision pack. The author page already supplies
a one-cell catalogue. Drop the full-grid collision reference when pruning the devserver or preparation archive, so the
in-page server opens that cell without asking for the discarded part. The normal release build still has its full grid.
