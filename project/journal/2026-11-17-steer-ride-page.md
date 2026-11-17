# 2026-11-17 a steer ride on the page (opus-ss10h)

SHARD-SOURCE SS-MS2a3, the page's half of the land-sail. The server
already leads the rider's body and steers the vehicle by the rider's
stick split along its heading; the page only presents the ride.

A steer vehicle's two carry prompts are in its own frame, so the page
moves them with each row's pose (`vehiclePoint`, the server's). The
board prompt shows while nobody on this page rides it and it stands; the
leave prompt shows only to its rider. Other carries keep their old rule
(every prompt hides while one moves), which would have hidden the leave
prompt from the person riding.

`installSteerRide` finds the vehicle this page rides: the wire says the
server leads the body, and the body sits on that vehicle's seat. It faces
the heading on boarding, turns the view with the vehicle, and swings it
back behind once the rider stops looking for 0.8 s. The stick is read in
the view's frame and split along the heading by the sim, so a view behind
the sail makes forward mean forward. A chip at the bottom shows the speed
(measured off two frames' poses, as a share of the boosted top speed)
and lights BOOST past the plain top speed.

Boost was a developer-only button. The sim now also boosts on sprint:
Shift on a desktop, and on a phone the stick pushed all the way, which
already sets sprint on foot. The page sends no new bit.

Not done: client prediction of the ridden vehicle (SS-MS2a3b). The rider
sees the sail a round trip late; that row reruns `MoverMechanic.step` on
the page if it feels slow on staging.
