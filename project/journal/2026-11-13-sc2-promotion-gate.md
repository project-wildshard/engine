# SC2: production promotes only a client its world runs

SHELL-CUTOVER SC2 (was WWW W8) asked for the "matching health before
alias LAST" order in code, not in a release lane's hands. It is in
code already: `scripts/page-release/flow.mjs` (the committed page
release flow, `ebeee3f4`) re-reads the channel's signed release file
and its world's `/health` in go-live (`readGate`). It refuses, before
`host.goLive`, unless `production.json`'s `engineBuild` is this build
and `/health` shows this build at that serial, each with its reason.

The tests pinned that on staging only. `page-release.test.ts` now
runs the production channel: a candidate production's signed release
doesn't name holds with "serial 8 signs <build>, not <candidate>", a
world still on another build holds with "health shows …", and play's
alias never moves. Mutation check: with the engineBuild comparison
removed, the test fails.

Wire v1's "same wire major" rule is not written yet; until wire v1
the row asks for the exact engineBuild match, which this is.
