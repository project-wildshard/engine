# Phone-tier memory refusal

> Written by: Codex
> **State:** loopback Chromium proof passed 2026-11-17 (MEMORY-GATES MG3 and MG7).

The phone gate stopped Pine Hollow before control. The generic failure card truncated the estimate and advised reloading.
The card now shows the full estimate and offers the title screen. The report and Details retain the boot failure.

The preview was built from engine main `dc0304da` with the changes in this commit (`dc0304da-mwl85x0w`). Headless Chromium
used a 402 × 874 touch viewport at DPR 3, phone tier and Developer off. The proof changed only the Pine Hollow discovery
response's `runtimeCost.webContentMB` to 2,200 MB. The engine displayed a 2.19 GB playing estimate against the 1.50 GB limit.
Control was never reached on that run. The title button returned to the title. The same build and shard reached control
and cleared its loading card with the original discovery in a fresh context.

[Refusal screenshot](2026-11-17-phone-memory-card.png)

```sh
bash scripts/serve-build.sh --head --port 0 --name phone-memory-card --hours 1
scripts/browser-lane.sh node scripts/phone-memory-card-proof.mjs http://127.0.0.1:<port>/ tmp/phone-memory-card.png
```
