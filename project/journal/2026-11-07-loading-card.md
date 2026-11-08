# LS2-LS6: the loading card Jake picked

Written by: Claude. Plan: meta repo `docs/plans/LOADING-SCREEN-PLAN.md`,
decisions J188 and J190. Built on LS1's collector at `2929143`.

## LS2, density 2

The card keeps its box and gains three phases that add up to the total:
Start (tap to this panel adopting the card), Download (until the spawn
download closes) and Load (until ready). Only the running phase shows its
rows; a tap on a phase head opens the others. The ready card's three
times are shown in tenths that add up to its clock.

Gone: the "Loading chunk ·" kicker that wrapped, the simple bar and its
line, the second size number, JS heap, scene textures, the frame-gap and
"Includes JS, GC, layout" lines. The tier line reads tier, visit and
attempt. Download's head carries one number, "12.0 of 23.1 MB", then
"2.2 MB downloaded, 20.9 MB from cache" in its rows. Load's rows run in
step order without step numbers, the quick steps' total last.

Start is painted before any module by the inline clock script: one share
per completed LS1 boundary of `START_STEPS`, and the page's finished
files and bytes. Loading writes its rows from the same collector.

## LS3, real numbers

Every bar write goes through one precision, so two writers of the same
reading can no longer step a bar back (a real throttled boot showed
52.735 % then 52.7 %). `scripts/loading-bar-rule.mjs` reads a recorded
boot: stalls over 2 s with under 1 % across the bars, named by the stages
the card showed, bars that run backwards, and bar changes with no LS1
counter, step or producer report under them. The manual proof
`scripts/loading-card-proof.mjs` records that on real boots.

## LS4, Copy diagnostics

Once ready (or after a failure) Copy diagnostics takes Hold's place. It
copies the phase times, tier, attempt, cache split, every Load row and the
full LS1 timeline. Clipboard API first, a selected text area on refusal.

## What the real boots say (LS3)

iPhone-size Chromium at 4x CPU and 12.8 Mbit/s, and WebKit, through
`scripts/browser-lane.sh`. Template: no stall in WebKit; Chromium held
2.0 s in `shaders > firstFrame`. Sunscar Dunes: Chromium held 5.2 s in
the same stretch, WebKit none. No bar ran backwards and every change
traced to an event. Shader compile and the first frame report no finer
progress, so that stage needs it. On Jake's phone the long stretches were
Start's imports and Server world; these local boots are too fast to show
them, so the phone's Copy diagnostics is the next reading.
