# STAGING-QA M3 (opus-sq), 2026-11-18

- SQ16, SQ14: each staging-qa leg now runs a budgeted list of steps (staging-qa-budget.mjs). Measured on the MacBook today:
  local with the gate crossing 4.2 min (build 54 s), Simulator Safari on staging v0.1.44 55 s with its boot, candidate K6
  six cards 146 s. phones.yml retired: its hosted runners have no GPU, which is why 25 of 30 runs failed.
- SQ9, SQ11, SQ12, SQ13: on a deploy K6 gives every Shard Select card the deploy checks (play, error card, stick, black world;
  a card it cannot enter is a failed leg, not a skip). K2 is Jake's SB48 phone in one leg: return visit, phone Low and every
  request 400 ms late from the title on (13.6 s to play on v0.1.44; before the title the old worker's precache takes 3 min
  through the route). Load budget: K2 over 20 s is a P1, a leg over 125% of the last release's a P2, K6 per card. The
  vision judge only reports, skips held scenarios, 12 calls at most, 4 at a time (K6 one sheet, a column per card). The
  store keeps each release's newest row per scenario, so the candidate's K6 survives the live leg's K3.
