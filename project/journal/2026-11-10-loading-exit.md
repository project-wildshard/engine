# A way out of a shard's loading card

Jake, QA 30: "on the loading screen when you're going to the shard,
there's no more menu… You can't like regret loading the wrong shard and
bail out and go to the other shard."

The card now has a row under it with SETTINGS and EXIT TO TITLE. Settings
opens the same boot settings panel as the title. That panel used to assume
a configured level, so it now waits for one before it shows the per-level
rows. Exit leaves the same way pause ▸ Exit to main menu does
(exitToTitle.ts). It records a purposeful end, waits for nothing it doesn't
hold and replaces the page with a fresh `/`. The half-built world's
workers, reads and server link all end with that document, so nothing of
the old load can land on the title. A mid-play cell load (scoped) has no
row; it has the pause menu.

scripts/title-exit-proof.mjs proves it in a headless browser. It starts
Driftwood, exits mid-load, opens SHARD SELECT on the title (QA 28: the
deck, no load), picks Nine Dragon and waits until it is playable.
