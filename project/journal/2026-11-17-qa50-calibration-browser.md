# Launch the Chromium executable the calibration test checked

QA50, run 44225586636, tests (8). The runner had full Chromium in
the Playwright cache. The calibration suite passed its availability
check, then setup looked for the separately installed headless shell
and both cases skipped with a suite failure.

Launch the full Chromium executable directly when that is the
available browser, and close the HTTP server even if launch fails.
Keep the WebKit path and the skip for a machine with no browser.

A cache with full Chromium and no headless shell reproduces the
original setup failure and runs both calibration cases after the fix.
