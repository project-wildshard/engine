# Apply creature knockback as metres

> Written by: Codex
> State: verified locally, 2026-11-17.

Declared strike contact can carry a horizontal shove distance into the
existing damage pipeline. The standalone server and borrowed page
player use the current motor and shove curve. Its fixed-step integral
converts the distance into a starting speed. Legacy blows still use
their damage-based speed.

The real player motor travelled within 0.5 m of the requested 6 m.
The same strike without a shove dealt its damage without displacement.
This builds the engine primitive. The format effect and two-page
warning still have their own integration and hosted proofs.
