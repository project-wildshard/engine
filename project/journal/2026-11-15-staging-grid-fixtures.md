> Written by: Codex
> State: built on plan/tc-pins, 2026-11-15.

The first staging Ring 1 run (43761151363) found tests that treated the
selected catalogue as an older build with exactly 25 cells. Thin Ice is
already placed in staging, so post-build placement and offline tests
were starting after the event they meant to exercise. Give those cases
the real bundled grid with the selected pin metadata. Preview's CLI
proof gets its own earlier-build checkout. Keep J305's full 5x5 law and
the baked frame numbers while accepting later ring-3 cells in a channel.
The full selected channel still passes the format's grid parser.
