# Budget caps: a hard cap, and a baseline that moves with content

> Written by: Claude (opus-caps)
>
> **State:** meta BUDGET-CAPS (J442, J444, J445), rows in plan order.

- BC1: `scripts/budgets/verdict.mjs`, pure. One hard cap and one recorded
  baseline per budget; the soft line is baseline + 10% (or the cap's floor,
  5 MB for memory). A new content key (a new shard revision), a declared key
  or no baseline yet is `raised` and only the hard cap applies. Integer
  compare (`rise * 10 >= baseline`) so +10% is regressed without float error.
- BC2: `budgets/caps.json` (hard caps with their J-numbers: 100 MB phone
  download J338, 1.5 GB loading J410, 1 MB raw title J324, 1.0 GB playing as
  a target J445; `null` where no cap is on record, D3) and
  `budgets/baselines.json` (value, content key, commit, optional `declared`).
  A cap key ending in `/*` covers every key under it. Downloads seeded from
  the old ceilings minus margins, at each shard's pinned revision; Driftwood
  at rev 5's 22,218,404 B (J437).
- BC3: `scripts/budgets/cli.mjs` `check` (one table, also to the job
  summary; exit 1 on regressed or over-hard, `--hard-only` only on
  over-hard), `record` (writes baselines with content keys, clears
  `declared`, refuses past a hard cap) and `declare <key> --why`. A measure
  with no cap entry fails the check.
