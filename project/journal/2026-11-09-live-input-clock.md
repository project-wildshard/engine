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
