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

FM3b: both native strict browser refusal controls now prove exit 1 for an
absent screen and exit 2 for an unmatched injection. The real Chromium
release-503 case passes through healing to world frames. Receipt admission
requires captured primary copy, a matching screen, screenshot, observed
injection, recovery and a bounded deadline; missing evidence becomes a
harness failure. Fixture stamps bind key/build/release/API origin, inputs
claim fresh directories, requests stay on the owned loopback origins, and
uncaught page exceptions refuse qualification. Baselines remain honest
nonzero censuses. The two-browser census is running; hosted CI is owed.

Urgent stale-shell priority checkpoint: a temporary npm-distributed native
Postgres 18.6 binary under this lane's scratch unblocked the real fresh
cluster/data-directory/drained-port proof. Public failmode-rig-proof.mjs
passes with an explicit binary directory. Both native proof lifetimes are
bounded. The download quota runner now applies/readbacks Chromium's actual
1-byte origin quota and observes the transient loading screen before control;
WebKit's page-realm Cache API injection stays labelled. That browser quota
change is not yet qualified. The running census was intentionally stopped
for Jake's 10:17 stale-shell regression; no incomplete census earns a tick.
