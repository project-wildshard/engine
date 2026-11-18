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

## 3. EM11 refit on clean readings

Every reading in the fit is instrument minimal: the v0.1.36 Nine rev 2 anchor (build `6f53e748`, 4 cold runs) and seven
fit zones on `037d9f15` (Template, Dunes, Pine, Nine, Nalati, Driftwood, Far Reach; 3 runs each) plus one Chromium
probe each (Driftwood's probe stalled at `gameplay`, so it has none). `phone-model.json` records `instrument: minimal`,
and the full-mode anchor stays as `test/fixtures/memory/phone-anchor-v0136-nine-full.json` for the comparison.

**What changes in the anchor.** The phone died in the anchor's last `compile:after` window and lived through the one
before. Read clean, that window's WebContent is 1,623-1,642 MB (full mode read 1,787-1,843), and the GPU process does
not move. The inspector's ~170 MB had been standing in for phone memory, so the anchor gave the GPU process less weight.
Clean, the GPU share has to carry more: **alpha 0.309-0.744 (was 0.199-0.474), scale 0.648-0.911 (was 0.606-0.816).**
The anchor absorbed the inflation: the zones' upper bounds barely move, and the central figures fall by 0-7%. Reading
clean zones with the old model would under-predict by 8-15%.

Same build (`037d9f15`), the 4 alternating runs per mode of section 1, GB central (upper bound):

| Zone | Old model, full readings | Refit, clean readings | Old model, clean readings |
| --- | --- | --- | --- |
| Template playing / loading | 0.62 (0.66) / 0.81 (0.92) | 0.61 (0.68) / 0.83 (0.97) | 0.56 (0.61) / 0.75 (0.87) |
| Nine playing / loading | 1.09 (1.18) / 1.87 (2.06) | 1.02 (1.16) / 1.71 (2.01) | 0.92 (1.04) / 1.59 (1.82) |

Fit zones (median of runs, central (low-high), MB): Template 613 (481-677) / 820 (667-938); Dunes 704 / 1,017;
Pine 989 / 1,247 (1,001-1,407); Nine 1,001 / 1,743 (1,334-1,888); Nalati 1,011 / 1,338 (1,075-1,511); Driftwood
1,000 / 1,194; Far Reach 729 / 993. peakOverSettled 1.195-1.74 (central 1.337). Ledger fit WC 381.3 + 3.328/MB,
GPU 331.3 + 1.255/MB, worst leave-one-out miss 30.8%.

**The Chromium reader.** Clean phone peaks put the zones' phone-over-renderer ratio at 1.90, which would read the
anchor's own Chromium renderer (1,029-1,063 MB) at 1.96-2.02 GB, under the line the phone crossed. `phone-fit.mjs` now
holds the central factor at or over the limit over the anchor's lowest renderer peak (2.086; bar 1.18-2.60).

The 27-zone table (highest run's upper bound) is in meta MEMORY-GATES MG11, "EM11b standing".
