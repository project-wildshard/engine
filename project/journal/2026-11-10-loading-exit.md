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

## QA 28: SHARD SELECT loaded Driftwood

Jake on preview 0641eaa: "pressing shard select loads me instantly into
driftwood." Same bug as QC2. SHARD SELECT answers its tap on pointerup and
swaps in the deck. At 402 × 874, ENTER WORLD (y 698–762) lies under the
card's lower quarter (y 594–748). A scan of preview found 24 of 100 points
on the card over it. iOS then sends that tap's click to ENTER WORLD.
`followsTap` dropped such a click only within 500 ms, and a busy page (the
answer builds the deck and its hero) delivers it later. The fast headless
runs never reproduce it; a click 700 ms late lands on ENTER WORLD.

The rule no longer uses time: a pointer click where the last answered tap
was, with no press anywhere since, is that tap's. A new gesture always
starts with a press, so it still acts, and keyboard clicks (detail 0) act.
Each tap target's scope watches presses on the document. Five seconds
remain as a backstop.

## J206 review

Codex found no MUST (review
`~/.cache/wildshard/session-keep/reviews/opus-titleversion-engine-20261110-J206-qa28-30.md`).
Its SHOULDs are done. The menu buttons no longer re-enable pointer events
during the card's fade-out, and Exit keeps an explicit `?sw=0` on the
title it leaves for. The proof now taps SHARD SELECT's lower quarter and
sends the late compat click itself. It closes Settings with its own CLOSE
and asserts that Nine Dragon is the world that loads. On a heavily loaded
machine the proof's waits are still timing-sensitive, so make them sturdier
as a follow-up. The behaviour itself was seen in the runs: Exit left
Driftwood mid-load for the title, and the late click stayed on the deck.
