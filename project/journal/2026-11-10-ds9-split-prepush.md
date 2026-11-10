# DS9: the split pre-push (DEV-SPEED, J222 with J240)

- The local pre-push stops running the whole Vitest suite for pushes that
  hosted CI gates: a `plan/*` branch push (J240: its branch CI must be
  green before the fast-forward merge) or a driver that sets
  `WS_PUSH_POST_CI=1` because it watches the exact SHA after the push.
  Static checks stay (types, lint, format, sides, asks, page events,
  test:kit); Vitest runs only DS1's related test files, minus browser,
  timing and >20 s files (Q54, logged to
  `~/.cache/wildshard/vitest-bench/hosted-only.log`). A full-mode change
  keeps the quick declared native files local. Hand pushes to main, tags
  and releases keep the complete gate.
- A main push of an exact SHA whose `ci` and `ring-1` are already green
  (the J240 landing after branch CI) reuses that hosted green and starts
  no local work.
- The split writes proofs under its own `split-v1` profile, so a release
  can never reuse a split proof as a full one.
- J206 review (Codex) fixes: the watching-driver flag splits only main
  pushes (never a tag, another branch or a refs-less release check); the
  hosted-green reuse counts only push-event runs of the ci.yml and
  ring-1.yml files, requires ci's code-proving jobs (changes, static,
  plan, e2e, every tests shard), and refuses once a lift-pending
  exclusion has expired. Branch CI triggers are opus-landflow's; until
  they exist a landing finds no hosted green and runs the full gate.
- The tests live in `test/gate-related-tests.test.ts`, not a new file: a
  new file's committed clocks hit the queue's
  `test/durations-source.json` snapshot-rebase conflict three times
  (jobs 299, 301, 307), so the landing is one squashed pair of commits
  with no timing-table change.
