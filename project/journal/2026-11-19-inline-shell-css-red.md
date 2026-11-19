# 2026-11-19: index.html's inlined shell CSS after row 51

Lane: buddy-engine (Coordinator-assigned red, run 44617020403, tests 8).

My 60e6a0696 (QA 11-19 row 51, the loading card's Settings removed) edited loading.css and did not rerun
`node scripts/inline-shell-css.mjs`, so index.html's inlined copy of base.css + loading.css (DL21) drifted and
test/inline-shell-css.test.mjs went red on main. The fix regenerates the block: the row's new comment, the menu row's
`justify-content: flex-end` and Exit's half-width basis.

Why the push gate let it through: the test reads the two sheets by path, not by import, so `vitest related` never maps
a loading.css edit to it. The gate's static checks now run the generator's own `--check` (milliseconds), next to
check:page-events, so the next drift stops at the push instead of on main.
