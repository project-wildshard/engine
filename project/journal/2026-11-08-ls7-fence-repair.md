# LS7: first-frame fences credit only signalled work

> Written by: Claude

Codex's review (docs/reviews/ls7-codex-review.md) reproduced three reds on real GL. The fences moved to render/fencedUnits.ts. Only ALREADY_SIGNALED or CONDITION_SATISFIED credits a unit. A lost context, at submit or in flight, and WAIT_FAILED reject without credit, and so does disposing the owner, which also settles a pending wait. Every exit deletes every queued sync. A real-WebGL2 probe passed in Chromium and WebKit: dispose leaves 1 created, 1 deleted, 0 live and 0 credited; loss before submit creates 0 fences and credits 0; loss in flight leaves 2 created, 2 deleted, 0 credited; a throwing callback leaves 2 created, 2 deleted and 0 live.
