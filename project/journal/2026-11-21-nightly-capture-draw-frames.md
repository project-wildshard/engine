# FS30 nightly capture and draw waits

Production nightly 44865741230 proved both Pine r9 cooks and both test
partitions. Chromium Pine timed out waiting for 30 draw samples under a
60-second clock. Chromium Driftwood drew 62 frames before its gameplay
PNG timed out in native capture. Hover now uses a frame window in
54dd91db40.

Nightly draw witnesses still require 30 distinct rendered frames with
positive draw calls. They get 120 rendered frames after the event and
a 90-second wall ceiling. Hosted Linux Chromium gameplay screenshots
use that same window and still require a real PNG and a pixel check.
The title and the blocking grid case keep their existing deadlines.

Focused tests collect the full 30 draws on a simulated 63-second run,
reject a stalled page at 90 seconds, and end the in-flight PNG attempt
when its frame window expires.
