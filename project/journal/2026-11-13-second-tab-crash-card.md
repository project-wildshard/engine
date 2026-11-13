# The second-tab crash card is pinned as a known failure

SENTRY-TRIAGE S20. opus-iosmem found that "The game restarted
unexpectedly" can be claimed by a second tab: a new tab opened while
another tab plays has no session copy of `life.alive`, reads the
playing tab's fresh device beat in localStorage, and classifies the
last end as `unexpected`.

Its probe now lives next to `lastEnd.ts` as
`lastEnd.reloadKinds.test.ts`. A browser reload, a service-worker
update reload and a bfcache hide and restore pass today. The second-tab
case is `test.fails`, so the suite stays green while it is broken and
turns red the day a fix lands, which is the cue to drop `.fails`.

The fix itself needs a lane: a page id on the beat and a liveness
check of that page (a Web Lock or a BroadcastChannel ping), which makes
today's synchronous classification asynchronous.
