# 2026-11-19: the beacon's site token stops tripping the blob check

Lane: buddy-engine (keeper, J249). MAIN RED run 44596509325, tests (1).

bef3e3273 (QA 11-19 row 19) added the Web Analytics beacon with its public site token in
`const BEACON_TOKEN = '<32 hex>'`. The push's blob check reads any name ending in `token`, set to a long
quoted value, as a credential. The lander pushed with ALLOW_SECRET=1 (J381) and said why, but CI's story
step runs the same check with no override, so the run on that tip went red.

The constant is now `BEACON_SITE_ID`, with a comment saying why. The value and the beacon's
`data-cf-beacon` JSON (`token: ...`) are unchanged. The hook has no allowlist for a public value, so a
name that doesn't match is the fix that holds on a rescan.
