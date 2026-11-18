# STAGING-QA M3 (opus-sq), 2026-11-18

- SQ16, SQ14: each staging-qa leg now runs a budgeted list of steps (staging-qa-budget.mjs). Measured on the MacBook today:
  local with the gate crossing 4.2 min (build 54 s), Simulator Safari on staging v0.1.44 55 s with its boot, candidate K6
  six cards 146 s. phones.yml retired: its hosted runners have no GPU, which is why 25 of 30 runs failed.
