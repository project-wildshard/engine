# 2026-11-19: back from an app switch, play goes on

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 rows 14 and 37; J449).

Jake's iPhone home-screen app: switching apps and coming back opened Settings, under a "RECONNECTED ·
you're back online" toast. J449: we're an MMO, the game does not pause on an app switch, and coming
back never opens the pause or Settings menu.

Three things paused it:
- the HUD's window blur pause (KP4, for ⌘T and ⌘N on desktop): an app switch blurs the window. It is
  gone. Held keys and touches are still let go on blur, and a desktop page that loses its pointer lock
  still pauses.
- GpuRecovery's hide dispatched `ws:background`, which the HUD turns into the pause menu. Hiding is now
  only noted.
- a WebGL context the system dropped behind the switch also dispatched it. That case restores and plays
  on, because restore ends the frame hold. A context lost in front of the player still pauses.

The toast: a link dropped behind the background (cause `hidden`) now redials quietly. There is no
banner for its first 5 s, and "Reconnected" shows only after an outage the player saw (a banner or a
card), i.e. one that stalled play. A tap still gets its hold card, and the offline card is unchanged.
Reconnect, the forceUpdate check and lastEnd on return are untouched.

Row 37: the STAGING badge (`stagingMark`) is gone from every screen with its CSS (including the 22 px
make-room rules from f51b3b4ef), the T1 phone probe that judged its placement, and its tests. The
version chip stays.

Tests that failed first: app-switch-no-pause (2 of 3), gpu-recovery-conditions (hide, then a context
lost behind the switch) and online-link-screens (3 new).
