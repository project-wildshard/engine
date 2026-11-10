# Boost on a HOVER double tap, a calm chat corner (QA 42, 43)

Jake reviewed the A14 HUD board at ~18:35 Cancun ("clearly after is
better than before") and asked for two more changes (meta
QA-FEEDBACK-2026-11-10 rows 42 and 43).

Boost (row 42): "Let's get rid of the boost button. Let's make boost
be like an undocumented double tap on the hoverboard ... When you hit
it once, you get on the hoverboard, you get off the hoverboard."

- The BOOST button (G540) is gone. `ui/hoverBoost.ts` now holds the tap
  rule, and `Player.tapHover` is the `hover` action. The H key and the
  HOVER tab are both that action, so the keyboard double-taps the same
  way. There never was a key for boost; the desktop's only control was
  the BOOST button, which needed a free mouse.
- No lag on a single tap: the first tap acts at once, exactly as
  before. A second tap within 300 ms toggles boost and leaves the rider
  on the board. If the first tap stepped off, the second steps back on,
  a short dip that the board's 0.25 s fade mostly hides. The other way
  was to hold every tap for 300 ms to see if a second one comes, which
  delays every mount. Jake rides far more than he boosts.
- The second toggle reads `player.hover` live. On an online page whose
  first press is not stepped yet, it cancels that press rather than
  doubling it (unit test).
- The look: the HOVER tab burns amber, and the board's repulsors (pulse
  and glow) go amber while boost moves the board. The repulsor tint is
  the only look on a desktop. There was no boost effect before this,
  only the speed.
- Unchanged: Developer-only (isDev on the client, allowDeveloperBoost on
  the server). The latch still outlives a dismount, as the button's did.
  With Developer mode off, a second tap is just a tap.
