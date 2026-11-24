# HS6e: the server reads server/plan only (built ahead)

> Written by: Claude (lane opus-prune1)

`serverPlan.ts` drops its fallback to the page's `client/plan`. Of the pinned products only Pine Hollow carries `server/plan`
today, so this branch (`plan/hs6e`) lands only after the wave 3 roll ships an SDK with HS6d to every live shard.
- opus-popin: test/pinned-server-plan.test.ts gates HS6e: every pinned shard with a client/plan also carries server/plan, or the build without the fallback would host it with no features. A channel runs one build with its own pins, so prod only gets HS6e through a build whose pins pass. Red until open-plot-desert-ruin and open-plot-thin-ice (r1, no SDK) are republished on SDK 0.4.29 and pinned.
