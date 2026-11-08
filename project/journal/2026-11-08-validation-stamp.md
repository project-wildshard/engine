# Retain the dependency revision

Normal generation after dependency cleanup 94a1557 recalculated the tracked
admission revision from its changed package and lockfile. Keep that generated
stamp with the manifest it describes; installed consumers have no lockfile
to recompute it. The v0.1.2 version bump will stamp its own revision again.
