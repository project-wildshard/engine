# 2026-11-12: a held kit.melee swings (TE-ENG4)

> Written by: Claude (opus-teeng4)

opus-mh7 found Mossgate's iron sword (a `kit.melee` row) never moved on a strike: `DeclaredMelee.update` only kept the
model in frame. The row has no windup or active frames (a strike lands on its tick; `cooldown` is 0.08 s), so the swing
is a procedural arc of its own length: light 0.32 s, a short cock right then the sweep across and down to the left;
heavy 0.5 s, raised back over the shoulder then the chop forward. A light strike during a light swing comes back as a
backhand, and every swing starts from the pose the blade is in, so a fast tap never pops. The press on the wire, a
charged hold's release (the server strikes heavy then), or off the wire the runtime's `fire` phase starts it. The hold
now fills the touch ATTACK ring (`charge`). First-person only: another player's figure (`otherPlayers.ts`) holds a
stock blade and its row carries no strike. Pine's and Driftwood's native swords are untouched.

Test `test/declared-melee-view.test.ts` (Mossgate's row): red before, green after. Preview: Mossgate (sharddev
`77634b3` packed) in headless Chromium at 402x874 touch and 1280x800, real taps, clicks and a held ATTACK; no console
errors. Sheet in meta's `template-e2e-v3/progress/te-eng4-swing.jpg`.
