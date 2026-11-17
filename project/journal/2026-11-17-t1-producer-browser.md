# Install the browser T1 actually launches

J400 FL2 acceptance: job 133866937483 on 874350d057 did run all four
Template suites beside the producer, preserving their traces and
failure receipts. All four failed before a browser could launch:
the headless shell was absent. Products' own boot installs full
Chromium with --no-shell; the producer cannot assume another
runner's e2e installation or cache also contains the shell.

Install the exact Playwright headless shell before the T1 batch,
through the existing hosted install helper. Keep the same runner,
build, browser type, qualification policy and bounded batch. The
workflow contract fails first and passes with the cold-cache
browser requirement explicit. This is distinct from Nine's
separate bench-job browser installation repair.
