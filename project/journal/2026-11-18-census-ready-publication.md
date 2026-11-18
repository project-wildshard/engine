# Publish the census fixture's readiness atomically

> Written by: Codex
> **State:** fix forward, 2026-11-18.

Engine CI 44291731549, tests (2), failed TS12e2 when the Python parent
decoded an empty ready.json. The Node fixture opened the file before
writing the PID, and existence was the parent's readiness signal.
The failure occurred at 19.559 s, inside the fixture's 30 s deadline.

Write the PID to a sibling pending file and rename it once complete.
Delay 250 ms after opening the writer in a controlled fixture.
The original path reproduces the same JSONDecodeError. With the
rename, the real observer qualifies the full run and retains its raw
report. The deadlines, producer identity check and refusal cases are
unchanged.
