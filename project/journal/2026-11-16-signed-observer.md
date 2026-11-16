# Drive the observer through a signed grace

> Written by: Codex
> State: built locally, 2026-11-16; E7.2c.b.3, hosted proof owed.

The loopback fixture retains one native socket address across two actual
World instances. A real ReleaseWatch validates the signed new input and
starts World.beginGrace; expiry drains/saves and boots the new World.
The same observer/native clients redial through this path. Old health
never admits a new client. A bad signed update refuses with both links
owned; cancellation aborts a hanging metadata read and closes the pair.

Seven composed native controls pass. The first fixture changed its socket
mid-promotion: the observer correctly called that multiple releases.
Use a stable upgrade endpoint like the real staging route. No live service
restart or promotion occurs; final MS9 retains ordinary staged acceptance.
