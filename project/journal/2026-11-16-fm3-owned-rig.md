# Own the failure-proof rig before changing databases

FM3 previously accepted an arbitrary pgData directory and ignored pg_ctl's
start result before recreating saves_online. Its failure driver now opts into
an isolated rig: private matching Ed25519 fixture keys, fresh nonsymlink
work/data directories, free loopback ports, native initdb and a connected
data_directory check before DROP DATABASE. Setup unwinds every acquired
resource; forced child termination and cleanup errors stay failures.

Existing non-FM proof callers keep their database adapters (including the
Name proof's explicitly owned PGlite socket). Even that legacy start must now
succeed before any database mutation. Page readiness verifies the served build
and a live owned process instead of accepting a timeout as readiness.

Eight focused guards pass. This Mac has libpq client tools but no postgres
server binary, so the native database lifecycle proof remains a prerequisite;
that failure earns no qualification. No game wire or UI changes.
