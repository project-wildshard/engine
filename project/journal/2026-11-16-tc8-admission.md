# TC8: keep a hover tap until its network tick

> Written by: Codex
> **State:** implemented, 2026-11-16; hosted drill pending.

Actual Chromium run 43843656104 at dab0673f records a trusted
pointerdown on HOVER and exactly one accepted input action, while the
linked player never mounts. The board, equipment and input remain
ready throughout. It is not an absent browser event.

Player.stepDevice sampled its command before NetPlayer.step admitted a
server tick. Sampling clears the queued board edge; the live link can
then refuse that step because no server tick is available. The press
never reaches a subsequent command. A real Player/NetClient/NetRoom
native reproduction fails at the actual mounted-state assertion before
the fix, after refused render steps and twelve real server ticks.

The existing step interface now also accepts a device reader. NetPlayer
calls it only after admission, and still accepts already sampled wire
commands. Player supplies one reader created per instance, with no new
per-step allocation. Tick credit, prediction limits, server authority,
boost gestures and render/capture pacing stay intact.

The explicit native proof spends the live tick budget, taps mount and
unmount during refused render steps, then observes both sides and the
server's exact two transitions on the real bytes. It passes with the
fix; the existing live/paused/capture/Low Power/unseated cases pass too
(15 cases, 1.31 s total). Compiler, focused typed lint and actionlint
pass. Its new coverage reports after CI wall accounting during the
one-week soak and stays outside ordinary discovery and hooks.
