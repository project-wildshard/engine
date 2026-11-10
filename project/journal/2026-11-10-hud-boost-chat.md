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

Chat (row 43): "get rid of these icons for team members. Let's just
have chat and the little microphone button ... messages should fade
... after 5 seconds ... when you press the chat box ... some form of
chat overlay that takes up way more space ... not a modal."

- `chatCorner.ts` holds the two rules: a line is fresh for 5 s, fades
  for 0.6 s and is then gone from the corner, and only focus opens the
  chat. The corner shows only the input, the mic and the voice tip.
  Its lines let taps through to the game.
- Focusing the input sets `data-open`. That gives a panel (phone: full
  width from the top, at most 52 % of the height, and above the
  keyboard through visualViewport) with a × header, the players on
  voice as rows with the speaking glow and a Mute / Muted pill, and the
  history (50 lines) with Report on other players' lines. A tap outside,
  the ×, Escape or an empty Enter closes it. Sending keeps it open, so
  you are in chatting mode. The outside tap is a capture listener that
  never stops the event, so the game still gets that tap. The panel is
  z 950, under the failure-mode cards (2147482300+). `data-ws-menu`
  still hides it all (QA 15).
- Escape from a text field still pauses the game (InputService let it
  through on purpose), so Escape in the chat used to open PAUSE. A field
  marked `data-ws-own-escape` now keeps its Escape. The chat field
  closes the open chat on it instead (key-swallow test).
- hud-worst gains `--states` (faded, open, closed, boost off / on), and
  its chat-rev copy tolerates a rev with no chatCorner.ts.
- The CI hover proof now drives the double tap through the real Player
  and the HOVER tab's amber look, instead of the removed button.
- hud-worst `--states` commit: the shots for Jake's board, before (a92de6c,
  its BOOST button) and after, at 402x874 and 1440x900 in Chromium and
  WebKit. The closed state is a tap outside, not Escape: on the old build
  Escape from the chat opened PAUSE and froze the boost shots.
- J206 Codex review (a92de6c..17f99d8): one MUST, fixed. Escape on a
  focused Mute or Report button in the open chat reached PAUSE. Now the
  open chat box carries `data-ws-own-escape`, InputService leaves an
  Escape from anything inside it alone, and the box closes on it. Its
  SHOULD, also done: hud-worst `--states` now fails `--check` when the
  corner hasn't faded, the open chat lacks a line or the players, or a
  tap outside leaves the chat open or its field focused. It no longer
  force-blurs on a QA 43 build. The HOVER tab's boost look is now solid
  amber: the outline-only amber was easy to miss on the phone shots.
- New test files' clocks recorded with `push-preflight.mjs timings`.
