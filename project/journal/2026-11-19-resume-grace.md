# 2026-11-19: five quiet seconds after an app switch

Lane: buddy-engine (QA-FEEDBACK-2026-11-19 row 56).

Jake, 16:17 Cancún, Nine on his iPhone: "When I tab in iOS and app switch, and I switch back to the game, it shows me the
reconnected ... only show me that when it's a real reconnection issue. When we tap back into the game, I have a
5-second grace period where you don't show me this shit." His screen had RECONNECTED · you're back online, and the
frame meter read "max 17190 ms".

Row 14 (J449) already kept a return quiet, but only for a drop whose cause was `hidden` and only while `downMs` was
under 5 s. iOS suspends the page outright: the socket dies with no event, the page notices on return (closed or
silent), and `downMs` already counts the suspended seconds. So the banner showed at once, Jake saw it, and the
Reconnected notice followed.

Now the page's return itself (visibilitychange to visible, or pageshow) starts a 5 s grace, whatever the cause. In it
there is no banner, the quality sampler skips (the wake-up RTT is not the line) and drops any chip from before the
switch, and a reconnect inside it says nothing because nothing was seen. If the link is still down when the grace
ends, the once-a-second check paints the banner, as J449's did. The frame meter resets its window on the same return,
like a closed frame gate, so the suspended time is no frame.

Tests: online-link-screens (a closed drop seen on return, pageshow, an RTT spike, an outage past the grace, a drop
with no return) and Perf (a 17.19 s gap whose first frame beats the event). The headless pass on row 14 could not see
this, because a headless close is not an iOS suspend. The Simulator proof runs on staging once v0.1.53 carries it.
