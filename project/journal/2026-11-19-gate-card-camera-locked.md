# 2026-11-19: the gate card stays in front of you

Lane: buddy-engine (QA-FEEDBACK-2026-11-19 row 53).

Jake, 16:12 Cancún, at Driftwood's gate from the road: "it needs to float like a fixed distance away from your face, no
matter which way you're looking ... when you walk up to the wall, you can no longer see it."

ZE8 pinned the DOM card each frame to a point on the gate's face, 2.6 m up, projected through the camera and scaled with
distance, and hid it once that point left the view. Walk up to the hex wall and the point is above the top of the
screen, so the card vanished mid-count. Look away from the gate and it vanished too.

The card is now a screen overlay for the whole count: centred, at 22% of the height (or under the top HUD row and the
safe area on a short screen), the spot where Jake read it. It takes no camera any more, so neither the view direction
nor the distance to the wall can move, shrink or hide it. The session passes only the name, the count and a reason;
the feet still pick which gate's card it is. gate-card.test.ts pins the overlay (no inline transform, five counts shown,
a reason alone, null hides it) and test/gate-card-css.test.ts its screen place.
