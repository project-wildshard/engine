# Keep the game report in the nightly Explorer proof

The first hosted Metal run finished Nine and Nalati boot, hover and draw.
Both Explorer legs then received 405 on the game's error-report endpoint.
Their receipts kept only the HTTP status, losing the reason for the report.
Intercepting the request in Playwright would disable Chromium's asset cache.

The local proof preview now acknowledges error reports. Explorer records the
raw request in the case receipt and refuses every report except the boot
watchdog's exact nonfatal slow-progress message. The ordinary catalogue,
pixel and fatal-screen checks still decide whether that case finishes.
Before the change, five tests showed the 405 and the missing reports. After
the change, the same tests cover transport and both passing and failed cases.
