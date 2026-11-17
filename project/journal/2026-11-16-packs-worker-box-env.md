# Move the box's env off the packs Worker

> Written by: Claude
> **State:** prepared, 2026-11-16. PACKS-CDN PC3g (meta docs/plans/PACKS-CDN-PLAN.md).

The `wildshard-packs` Worker still serves about 3,300 requests a day. A
tail showed all of them come from the box: both servers poll their
release file and read server books through it, because the root-only
`PACK_ORIGIN` and `RELEASE_URL` rows were filled before PC3 and
setup-state only filled blank rows.

Prefill now moves a row that is exactly the Worker's address to
packs.wildshard.io, keeps every other value (with a warning when it
still names the Worker), and setup.sh restarts a running server whose
row moved. The agent applies it with `wildshard-apply <tag> setup`
once a signed release carries it. PC4 then waits 7 days of zero
traffic and deletes the Worker, along with every `PC4-REMOVE` line.
