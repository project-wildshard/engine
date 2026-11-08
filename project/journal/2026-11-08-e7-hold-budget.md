# Keep both real-clock hold branches inside CI

2026-11-08. Exact E7 Ring 1 run 42500064545, job tests (4), passes all
181 files and 850 assertions, then correctly fails the named file
budget: dedicated-hold is 63,614 ms, above 60,000 ms. The combined
20-second and 40-second real TCP outages cannot fit that cap.

Split the retained scenarios into independent fresh sessions and files.
Both still use the real room, real 30-second hold, real proxy silence,
real clients and native world. Keep the 4.5-second silence assertion,
20-second same-body return, damage/coins/cape checks, 29-to-31.5-second
expiry, other-client survival, and 40-second saved-position/health/pack
return. Keep all existing timeouts and file/shard caps. No fake clock,
shorter delay, quarantine, omitted assertion or gameplay change.

The second scenario no longer needs the unrelated earlier short outage:
it earns its own body, inventory and stood position before disconnecting.
A shared fixture owns and closes both clients, the TCP proxy and room.
These are retained real-time protocol checks, split for the existing CI
file budget, not new slow coverage or a change to hook discovery.
