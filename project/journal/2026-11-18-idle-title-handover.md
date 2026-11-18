# An idle old title gives way to the candidate

Staging smoke K2 (`old-cache-first-page`) kept failing on v0.1.40 even
after K1's worker fix. The candidate worker installed and activated
within 20 seconds, yet the old title stayed on screen. An update
worker skips waiting on its own (sw.js STALESHELL) but claims no
document: claiming slowed warm Home from 13.84 to 19.62 s (039d). So
the old document kept its old code until the player's next navigation.

The worker could navigate its clients, as J383's forced path does, but
that would yank a menu the player has open. The page reloads itself
instead. `sw.ts` announces a worker of the live build activating
behind a controlled page (`ws-sw-activated`, `__ws_sw.activated`). The
cold title reloads only while idle on the main screen: no ZONE SELECT,
Settings, dialog or drop card, the tab visible and no input for 5 s.
A page that a hand-over opened never hands over again, so a worker
serving the wrong document cannot loop the tab.

This helps only shells built from this change on, so K2 can pass
two releases later at the earliest. `title-handover.test.ts` and
`sw-activated.test.ts` hold it until then; both failed first.
