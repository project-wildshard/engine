# Engine takes the kit's script-paths (opus-memfoot, meta QA 11-25 row 161)

- Engine's `.githooks/script-paths.mjs` was an older kit copy with a hand edit: a lean move counted only while nothing
  stayed tracked at its old place. The kit's copy (meta QA 11-25 rows 119 and 133) replaces that rule with stray
  findings and judges a package's `exports`. Engine is clean under it (0 findings, none new), so the file goes back to
  the kit's bytes and repo-kit's Consumer sync stops calling it diverged.
