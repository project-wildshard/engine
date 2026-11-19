# main-watch names main-push pushers and wakes the keeper

> Written by: Claude (opus-cispeed)
>
> **State:** meta FLOW-SIMPLE FS19 and FS22 (J443).

main-watch named a red's pushers only from land's `landed` receipts, so
a red pushed through `main-push.mjs` named no one unless the follower
that judged it happened to be that push's own (26 of 52 reds on 11-18).
It now reads main-push's `pushed main <sha>: <n> commit(s)` receipts too:
the tip and the n-1 commits under it belong to that lane. main-push
writes its herdr pane into the receipt, so the alert reaches its pane.

The keeper (J443): `buddy-engine` already got a red when no pusher could
be reached. Now, when an alert was delivered but no green verdict comes
within 20 minutes of the span's first red, main-watch prompts the keeper
once per red span; a green ends the span. The state file keeps the span.

The FS22 mentions in yesterday's early-red commit are FS24: the plan's
FS22 became the keeper while it was in flight.
