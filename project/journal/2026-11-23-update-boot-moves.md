# An update boot never sits still (QA 11-23 row 8)

> Written by: Claude (opus-finish)

Jake, 11-23 on his iPhone 17 Pro home-screen app: the staging splash is
"frozen and really fucking slow", but only on a version update. Probed
from saved old-build WebKit profiles (402x874, 8 Mbps and 80 ms through a
throttling proxy, so the worker's fetches share the link too):

- From v0.1.72 (below the 0.1.73 floor, J383's wipe): the title of v0.1.74
  is up in 2.4 s. After ENTER THE MMO it then sits unchanged for 3.2 s
  (tap to leave): the world gate loads `online.js` and asks the world, and
  travel waits for the fresh worker's install. Nothing on screen says
  so. The leave page that follows is a bare dark page, and an old worker
  holds it there for up to 6 s while it asks the network for the newer
  build's page (row 50's network-first wait).
- From a v0.1.73 profile whose v0.1.74 worker is already active, the old
  title stays up; the pill reload reaches v0.1.74 in 1 s.

The fix makes the title's steps move. The tapped MMO button sweeps
while the gate asks, and a bar sweeps along the top once the title
leaves. The leave page is still bare: WebKit runs no CSS animation in a
document whose inline script already called `location.replace` (frames
identical over a second in every variant but one that defers the replace
two frames), so that is a follow-up. A navigation also pauses an
update installing behind the worker, so its generation download stops
competing with the document. The journey judge fails a screen that sits
still for over a second between the tap and the loading card, and
staging-smoke K2's old-cache journey runs that judge on every release.

The pause lives in the worker, so a phone gets it from the update after
the one that installs it. The title's motion comes
with the new title.
