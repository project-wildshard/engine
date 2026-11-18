# The harness's Web Inspector in WebKit [K] (mini-em11b, ENGINE-MEMORY EM11/EM12, 2026-11-18)

Mac mini, Playwright 1.65 WebKit headless, engine `037d9f15` with all 27 catalogue pins (served at the same bytes for
every run), phone view, phone tier, Low. [K] is kernel `phys_footprint`; "settled" is `measure.mjs` at control (two
forced collections, 2 s idle, median of five reads); "peak" is the WebContent interval high-water through control.

## 1. What the inspector costs

Playwright enables the Web Inspector's Network domain on every page, and WebKit keeps every response body for
`Network.getResponseBody` (base64, 1.34x the fetched bytes, up to ~200 MB) until the domain is disabled. It also
registers the error-report route, which turns on request interception and with it disables WebKit's memory cache.

**Full vs minimal, 4 alternating cold runs each** (`tmp/mini-em11b/inspector-ab.mjs`; minimal = Network and Console
domains off before the boot, no route). Median (min-max), MB:

| Zone | Mode | WebContent settled | GPU process settled | WebContent peak |
| --- | --- | ---: | ---: | ---: |
| Template | full | 530 (522-532) | 292 | 667 (661-678) |
| Template | minimal | 470 (463-474) | 289 | 602 (597-612) |
| Nine | full | 921 (898-941) | 518 | 1,652 (1,606-1,733) |
| Nine | minimal | 753 (697-773) | 518 | 1,365 (1,331-1,504) |

So the Network domain costs Template 60 MB settled and 65 MB at peak, and Nine 168 MB settled and 287 MB at peak
(its spawn download is past the ~200 MB retention cap, and the base64 copies are made while the boot peaks). The GPU
process does not move. In the same full-mode tab, `Network.disable` then two collections freed 46 MB (Template) and
180 MB (Nine): the same retention, read a second way. The ~170 MB in mini-ninesteady's settled Nine budget is this.

**Against no inspector at all** (`tmp/mini-em11b/no-inspector.mjs`, `variants.mjs`): Playwright's WebKit app launched by
hand (no inspector pipe) and the same app under Playwright with instrument minimal, both behind one proxy that injects
the phone save fixtures and the step log, same viewport (1280x720 @1), both visible; neither can force a collection, so
WebContent is read 15-30 s after control. Template: peak 579 (none, n 4) vs 577 (minimal): no residual at peak; idle
499 vs 596 is uncollected garbage. Nine (none n 6, Playwright n 10 across minimal, minimal plus `Worker.disable`, and
that plus `Runtime.disable`): peak 972-1,206 without Playwright vs 1,086-1,581 with it, idle WebContent 594-923 vs
649-1,151, GPU process 400-427 vs 522-545. Turning more domains off moved nothing outside the noise. So beyond the
Network domain, Playwright still costs Nine about 110 MB in the GPU process and leaves more JavaScriptCore garbage
standing, which a no-GC reading cannot separate from GC timing: Nine's settled minimal reading (753 MB after forced
collections) is above the no-Playwright idle floor (~610 MB without them), so up to ~140 MB of Nine's settled WebContent
may still be harness. Template shows no such residual. Only Playwright can force a collection, so the settled reading
stays a Playwright reading; the residual is common to the EM11 anchor (Nine itself) and the zones, so the anchor's fit
absorbs most of it.

## 2. The instrument

`scripts/memory/measure.mjs --instrument=minimal|full`, default minimal: after the same-origin warm-up page it turns the
page session's Network and Console domains off (Playwright's public API cannot; `minimiseInspector` goes through the
in-process server object and refuses if that path is gone), registers no route, captures the page's own errors in the
step log, and refuses a run whose page moved to a new inspector session. Every run line, the JSON (`instrument`) and the
CI step summary name the mode. `ratchet.mjs` refuses to compare a footprint baseline and runs read in different modes;
the committed Template baseline is marked minimal and keeps the full-mode value as an interim ceiling until the first
hosted minimal run sets it. `phone-fit.mjs` refuses mixed modes and records the mode in `phone-model.json`, and the
phone line warns when a run's mode differs from the model's.
