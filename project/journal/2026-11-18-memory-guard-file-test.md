# The memory guards test for their ratchet with a file test (main red, buddy-engine)

- Main went red on run 44233614563 (tests 5):
  `test-build-tools` "workflow cache keys hash only committed sources
  that exist" refused `scripts/memory/ledger-ratchet.json`. f4bbaf0e
  (MEMORY-GATES, "qualify subsystem and footprint gates") selects the
  ledger and footprint guards with
  `hashFiles('scripts/memory/<x>-ratchet.json') != ''`. That is a
  presence check on a ratchet the qualification run has not committed
  yet, so the file is missing on purpose.
- The guard logic is unchanged. Each "Select the committed or
  qualification …" step now runs
  `[[ "$MEMORY_RECORD" == true || -f <ratchet> ]]` in the shell after
  checkout and writes `selected=true` exactly when the old `if` did. No
  workflow hashes a missing source.
- Fixed both guards, since the footprint guard had the same check.
