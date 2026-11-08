# SR7: one command and one damage authority

The real Sky Reach fan's direct Heavy control reproduced zero attack
commands and zero server hits. The control only ran its page swing. It
now puts attack and heavy on the next command, without leaving heavy
held after that step. The existing held draw path is unchanged.

Wired BladeMoves still pose the hand and contact world objects, but skip
body settlement and body reactions on the page. The server's hit remains
the only weapon-hit presentation input. Three fresh iPhone portrait runs
per browser passed on Chromium and WebKit: direct fan Heavy landed a real
30-damage NetHit. Another six Sunscar whip runs each gave one NetHit, one
weapon.hit, and zero local damage.dealt. No event was emitted by the test.

The pre-SR1 build has zero damage floats. This lane deliberately leaves
clientWorker/RowBodies and the hurt/windup adapter to the SR1–SR3 owner.
The combined SR1+SR7 one-float play check must be run after that SHA is
available; these wire proofs do not claim the missing float is rendered.

Selectors are worker-client-proof --play --only=held-melee and its manual
split-repair helpers. No new hook entry or graphical work was added.
Types and lint pass. Publication/full pre-push stay held for v0.1.1.
