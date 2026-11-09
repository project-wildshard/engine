# Sustained input follows the server clock

The hosted Chromium road proof was still moving at its unchanged 210 s
deadline. Its visible SwiftShader page drew 69 frames over 91.7 s, while
native worker ticks cost 0.1–0.7 ms. A local frozen 4f31a1d boot reproduced
the same command starvation: roughly 7.5 presented frames/s, a healthy
59.95 server TPS, and only 811 m of the 1125 m road covered in 210 s.

The page sent at most three commands per rendered frame. Those are fixed
16.67 ms movement commands, so a slow GPU also slowed authoritative walking.
The world simulation was not the bottleneck and the walker was not blocked.

Keep the three-step frame cap, capture clock, server timestep, proof oracle
and deadline. A scoped live device timer now sends sustained movement against
new authoritative tick credit, at most three commands per wake. Three credits
remain for ordinary frame steps and their discrete actions. Paused, hidden,
tour and free-camera modes grant no credit; stale debt is discarded. Rides
retain their existing device path. Supplemental commands neither consume
presses nor advance the weapon's render-frame sequence count. Pending weapon
edges and callbacks wait for the ordinary device step.

The real Player, serialized NetClient/NetRoom and native Rapier regression
passes at 1 and 7 rendered frames/s with near-60 commands/s, matching server
steps and positions. Release, pause/resume and capture retain their bounds.
Existing rejoin, death, crossing and discrete-action checks also pass: 14
cases in 1.18 s. Browser crossing and the full publication gate follow this
source commit; they are not claimed complete here.

The full immutable 243e9f7 gate caught a real regression in this refactor:
the existing hook-wire case expected the claw's wire-only jump to stay out
of local body prediction. It had been passed to both. Restore separate
wire and prediction inputs; retain the original assertion and rerun it
with the player family before the next full capture.

The first exact 4ca Chromium road repeat is still red (320.9 m short at
210 s while moving, 6.7 presented fps and about 59.95 simulation TPS).
The native clock test does not establish that the live page timer is
active. Trace that page path before claiming a crossing fix.

The real live-page observer found only 34 timer-produced calls over about
19 s, while 1154 authoritative ticks arrived and 53 frames presented.
The timer was therefore still coupled to the congested page scheduler.
Replace it with the transport's actual authoritative-frame callback.
The bootstrap binds live mode and a pure current-control reader; every
received frame can use only new tick credit, and capture/paused modes
still grant no supplemental command. There is no input timer now.

The native regression now uses those actual serialized frame arrivals,
not an independent fixture pulse. It parks the live driver before its
acknowledgement-only tail, so those tail ticks cannot earn test movement.
All original command/position/capture bounds remain unchanged.

## Real browser boundary, df81be0

Exact build df81be0a-mw9mawkx, renderer revision
47caae1f211addefddfdbd1faa0678c903c71b5e3591e66da14064952a7c36ae,
epoch 1. Sequential iPhone-profile Chromium SwiftShader and WebKit runs
used the existing prove-release extended grid journey, unchanged 210 s
legs, actual controls, ready/current/inside/server checks and no backend
change. Both passed every leg, actual Ember entry, acknowledged save,
correct first card and complete safe native clipboard.

The 1125 m leg took 155.988 s in Chromium and 155.877 s in WebKit. Both
finished ready and settled with the Ember board closed. Reload restored
the earned Ember position within 0.423 mm and 0.213 mm respectively, with
no page errors. Both browsers closed. This is a local exact-build proof;
service workers were blocked here. Hosted staged SW/headers/API/full phone
proofs and production remain required, and production is still held.

J189 owns the next immutable stamp/full publication capture; no duplicate
full suite was started by this lane. The existing full-gate hook-wire red
is repaired in 8bffe37, with the frame-receipt driver in df81be0.
