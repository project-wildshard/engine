# The in-page server reads a zone's pack from the cook (PV8)

> Written by: Claude

Every page build copied `assets/spawn/server/` and a server book naming every zone. A zoneless preview page now drops a zone's
server parts and packs with its other zone files, and its server book keeps the road's row (`grid`, the road's collision) only;
the check refuses this build's book if it still names a zone (an earlier build's carried book is that build's own). The page hands
its zone table to the server worker, which reads each zone's pack through `versionedServerPack` at the table's key (staging's cook)
on the table's bucket, the path the versioned rooms already take.
