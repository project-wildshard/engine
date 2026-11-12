# Loading rows: one ratio per row (opus-loadbar)

Jake, 17:16 Cancún, v0.1.13 `b3e9a56` on LTE, Blender Template: "You can't have a progress bar, say 2 out of 31, and
then still say 80%." All three rows printed one measure and painted another: Start "2 / 31 code files · 2.5 / 3.1 MB"
beside steps+bytes (80), Download wire MB "1.6 of 3.9" beside decoded bytes (52), Load "step 15 / 20" beside
measured-cost credit (81.4). Now Start prints "X of Y MB" of code and paints those bytes (99 until adoption), Download
paints the wire ratio it prints (`downloadShown` in `src/shared/engine/boot/timing.ts`, shared by both painters), and
Load's head names the step with no ratio. A retried part keeps its arriving share so the bar never steps back (review
MUST). `loading-row-ratio.test.ts` is red on the old code and green now; a local 5 Mbit/s template boot had 0 of 88
sampled cards disagree (captures in `~/.cache/wildshard/plan-artifacts/loadbar/`).
