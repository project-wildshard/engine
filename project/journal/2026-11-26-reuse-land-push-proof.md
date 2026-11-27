# Reuse the land gate after a disjoint rebase

The stamped proof helper compares the replayed paths and their bytes.
The engine's normal pre-push still checks the outgoing commits. It can
reuse a completed local gate when main moved without touching the
lane's files, dependency locks, manifests or pins.
