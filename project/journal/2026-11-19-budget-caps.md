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
- BC3 lint, fixed forward: `judgeAll` builds rows with `Object.assign`
  (no-map-spread), the CLI finds its one positional (prefer-array-find), and
  `cli.d.mts` gets its blank line. It had refused main-push from this clone.
- P0 fix forward: `js/session/raw` 4,400,000 -> 4,450,000 in `lint/ratchet.json`.
  Main run 44464496865 built session raw 4,400,336 B after tonight's feature
  pushes (CC11a2c ability rows, FS17, TR-3 ring). Under J444 that is a declared
  raise by engine features, not a regression.
- BC4: `shard-size-gate.mjs` judges `download/phone/<slug>` with the verdict:
  the content key is the pinned revision, so a new revision is `raised`. The
  latch, the raises list and the 60 MB number are gone; 100 MB (J338) is the
  hard cap in caps.json.
- BC5: `check-chunks.mjs` judges `js/<label>/{raw,gzip}` against baselines.json;
  only `js/title/raw` keeps a hard cap (J324). The build writes
  `.vite/budget-measures.json` for the check that follows ci.
