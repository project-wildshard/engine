# Explore owns its browser proof

> State: release fix for v0.1.53, 2026-11-19.
> Written by: Codex

Release run 44634913183 found two errors in the new browser gate. The
standalone Explore spec sat in the Template suite's spec inventory, despite
building its own client. Give it a subdirectory and scope its Playwright
project to that directory.

Software rendering moved the camera 0.83 m in the first five seconds. The
flight step now checks for half a metre of displacement within 15 seconds.
That still catches the zero-displacement input regression. The whole
browser journey retains its 120-second budget.
