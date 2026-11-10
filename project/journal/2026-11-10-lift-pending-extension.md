# Lift-pending: the one J200 extension (CI21 option A)

- Jake picked CI21 option A (2026-11-10): extend the inherited
  lift-pending exclusion once, to 2026-11-12T18:00:00Z (Thu 13:00
  Cancun), under J200. 349 of the listed files still fail; at the
  original 2026-11-10T18:00:00Z deadline they would rejoin blocking
  discovery and turn every engine pre-push red.
- `scripts/lift-pending.mjs` had no extension path, so this adds the
  smallest one: an `extension` record in `test/lift-pending-policy.json`
  (rule J200, decidedBy Jake, decision, date, evidence, reason). It may
  move the immutable original deadline later by at most 48 h, and is
  frozen at its first introducing commit, so a second or edited
  extension is refused. The original-deadline check is unchanged.
- Evidence: https://claude.ai/artifact/PMEQD4VL7sHRS9PS1d5QpJ.
  codex-mock owns the restores and retirements next.
