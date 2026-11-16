# Free browser slots survive an admission clock tick

> Written by: Codex

> **State:** verified locally, 2026-11-16.

J249 follow-up to engine main 3206dc5e4b / CI 43836513698.
The shared-mover failure already has main's f2d3fad3 repair for the
Template revision 8 lift. Its focused case passes on the current pins.

The portable four-slot fixture gave every free-slot child the same
one-second admission wait used to refuse a saturated fifth child.
Advancing Bash's coarse SECONDS clock once before the first admission
probe reproduces an early exit 75 with zero of four slots occupied.
The original hosted failure hid child stderr behind an empty line.

Use the production maximum admission wait for free-slot children, still
bounded by the existing three-second entry assertion. Only the saturated
fifth child uses one second; its four-second subprocess limit, the other
subprocess limits, the eight-second Vitest child budget and all capacity,
release, exit-code and descriptor assertions stay intact. Production
admission code and limits do not change. Entry failures now include the
child's exit status and available stderr without waiting for more output.

The controlled one-tick case fails before and passes after the fix.
Both original failing files pass together on current inputs: eleven
cases. Fifty uncontrolled repetitions also pass across system Bash and
Homebrew Bash before the fix; that alone did not establish a repair.
