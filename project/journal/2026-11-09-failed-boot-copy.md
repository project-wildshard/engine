# Failed-boot Copy diagnostics lives on the fatal screen

LS4 (J188). After ef7a105 a real HTTP 503 worker failure reached the
loading card's Copy, but the fatal load screen (ws-load-error, fixed,
error layer) covers that card, and its stack pre took the tap in both
Chromium and WebKit.

The two surfaces now merge. The page's loading card lends its report
through ui/diagnosticsCopy.ts. The fatal screen adds Copy diagnostics
beside Reload, in flow after the stack, and removes the covered copy,
so the page keeps one. The heading, build, stage, message and stack stay
on screen. The payload is the card's own diagnosticsText(): build, tier,
attempt, cache and files, rows, and the full LS1 timeline.

Proof: a working-tree preview on localhost, Driftwood Isle, iPhone 16 Pro.
The real standalone server worker script is refused with HTTP 503. The
script makes an actual unforced Playwright click, then reads the clipboard
back. It passes in Chromium and WebKit. The clipboard text equals the
written text, the timeline entries match __bootTiming exactly, privacy is
urls-and-free-text-removed, the report is marked failed, and the button
reads Copied. Unit: load-failure-copy.test.ts.
