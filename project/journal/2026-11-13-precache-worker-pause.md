# A page's workers no longer hold the build precache paused

OFFLINE OF6. Audits saw `ws-builds-v1` empty after 20 to 60 s of play,
so LOAD's late code lived only in the HTTP cache. The post-control
precache steps aside for a loading page: a fetch from a client that
hasn't reported control pauses it and aborts its in-flight fetches. A
worker is exempt, but only one `clients.get` lists as a `worker`.

Two kinds of read slipped past that exemption and paused it every time:
a read with an empty client id (a worker's own script), and a read from
a client `clients.get` doesn't list (a dedicated worker some browsers
don't expose). Each such read aborted up to six lanes, and the next
controlled read resumed them, so a page whose workers kept reading kept
the precache from ever finishing.

`pauseForClient` now ignores an empty id (a navigation still pauses
through its own branch) and treats an unlisted client as not loading.
That result isn't memoised, so a browser that lists a page late still
gets its pause on the next read (claude -p review SHOULD, folded).

The new lifecycle test was red first; the existing yield test now lists
its loading page, as a real browser does. Still owed: the row's
done-when proof, `offline-proof.mjs` warm on a cold profile,
`ws-builds-v1` = 1 within 60 s of play.
