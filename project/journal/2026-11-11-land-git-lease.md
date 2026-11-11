# Land's plan push uses git's lease, not its own records (LAND-SIMPLIFY LS4)

J258. Land used to keep two per-worktree files of the plan SHAs it and
the pre-push had pushed (`wildshard-land-tip`, `wildshard-plan-pushes`,
written by `.githooks/record-plan-push.mjs`). Before rewriting the plan
branch it read origin's tip with `ls-remote` and checked it against them.
Two of the window's STOPs were that check refusing a lane's own pushes.

Now land reads origin's real tip, refreshing the remote-tracking ref,
which a hand push by URL leaves stale. It rewrites the tip only when the
local branch's reflog reached it: land's own pushes and hand pushes from
this worktree both pass. Anything else stops land before any push. The
push carries an explicit `--force-with-lease=<ref>:<tip>`, so a push that
lands in between is refused by git. `worktree new` leaves the branch a
reflog.

That is `--force-if-includes`'s rule without its timestamp window. The
plan first used git's flag itself, but the J206 review found a stale
tracking ref after a URL hand push. Refreshing that ref made the flag
refuse the worktree's own tip whenever the fetch came more than a second
after the commits, because it only reads reflog entries newer than the
tracking ref's update. The tests caught it as a flake.

One rule changes, and a test records it: a foreign tip the local branch
once held (reset or merged onto it) counts as seen, so the lease lets land
replace it. The old records refused that. Git's view is that you had
their work and dropped it yourself.

Deleted: `ownsTip`, `shas`, both record files, `record-plan-push.mjs` and
its pre-push line.
