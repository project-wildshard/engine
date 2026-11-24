# Two push-gate reds that were not code reds

> Written by: Claude (opus-popin), 2026-11-24, QA-FEEDBACK-2026-11-23-b row 43.

- codex-ms's v0.1.79 baselines showed two local push-gate reds that pass alone.
- `test/push-stop-cause.test.ts`: the J505 watchdog fixture handed `parallelChecks` the hook's own environment, so under the
  full push hook (`WS_CPU_ADMISSION=1`) its fixture steps ran inside `cpu-admission.py` and the watchdog timed the broker. The
  fixture now runs without that variable.
- `test/boot-audio-download.test.ts`: the four pinned-product cases read the app build's `out/.app/boot-tables.json`, so they
  skipped in a checkout without one and read whatever a stale build left. They now serialize this checkout's boot tables
  (`scripts/serialize-asset-tables.mjs`, 0.2 s) and always run. Running them showed the real fault: the fence counted a
  set's `music.json` / `sfx.json` manifest as a recording; it now holds recordings only.
