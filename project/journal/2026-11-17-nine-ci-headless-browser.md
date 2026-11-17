# Nine's street driver needs its headless browser

SB34 run44031662021 passed all ten packed/boundary jobs, then the Nine
street observation failed before measurement: benchmax's default
Playwright launch requested chromium_headless_shell-1254, which the
job's --no-shell install deliberately omitted. Its earlier stock boot
used full Chromium and succeeded, hiding the missing dependency.

Install Chromium with its default headless shell in the Nine observation
job. Keep the same benchmark driver, workload and ratchet thresholds.
The retained hosted failure is the negative control. The installed
Playwright dry-run includes the required shell; a muted native default
headless launch checks that path locally. Hosted observation follows.

Mode 1 release unblock; peers retain their J400 and zone-proof edits.
